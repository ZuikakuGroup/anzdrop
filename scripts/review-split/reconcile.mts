import { splitPlan, reviewState, type Group, type ReviewSignal } from "./analysis.mjs";
import { Git, assertSha } from "./git.mjs";
import { Github, canEdit, decodeState, encodeState, NOTICE_MARKER, STATE_MARKER, type Comment, type Part, type Pull, type State } from "./github.mjs";

export type Config = { fileLimit: number; maxFiles: number; maxSourceBytes: number; maxGroups: number; reviewBot: string };
export type Options = { enabled: boolean; appBot?: string; stateKey?: string; writer?: Github; noticeBot?: string };

function partBody(source: Pull, index: number, count: number, group: Group): string {
  return `<!-- anzdrop-review-split-part:${source.number}:${index + 1} -->\n元 PR: ${source.html_url}\n元 HEAD: \`${source.head.sha}\`\n\n${index + 1}/${count} の変更です。先頭から順に main 向けへ付け替えて取り込んでください。下流 PR を分割ブランチへ直接マージしないでください。\n\n静的解析による候補です。CI・CodeRabbit・人のレビューが必要です。\n\n結合理由: ${group.reasons.join("、") || "他の変更との静的依存なし"}\n\n変更ファイル:\n${group.paths.map(p => `- ${JSON.stringify(p)}`).join("\n")}`;
}

export async function inspectReview(api: Github, pull: Pull, bot: string): Promise<string> {
  try {
    const [statuses, checks, reviews] = await Promise.all([
      api.list<{ sha: string; state: string; context: string; description: string | null; created_at: string; creator: { login: string } | null }>(`/commits/${assertSha(pull.head.sha)}/statuses`),
      api.api<{ check_runs: { head_sha: string; name: string; status: string; conclusion: string | null; completed_at: string | null; started_at: string | null; app: { slug: string }; output: { title: string | null; summary: string | null } }[]; total_count: number }>(`/commits/${pull.head.sha}/check-runs?per_page=100`),
      api.list<{ commit_id: string; state: string; body: string | null; user: { login: string } }>(`/pulls/${pull.number}/reviews`),
    ]);
    if (checks.total_count > checks.check_runs.length) return "判定不能";
    const signals: ReviewSignal[] = statuses.filter(s => /^CodeRabbit$/i.test(s.context)).map(s => ({ sha: pull.head.sha, state: s.state, description: s.description ?? "", trusted: s.creator?.login === bot, date: s.created_at }));
    // Legacy CodeRabbit statuses can have a null creator (observed on #237).
    // Accept that surface only as evidence of skipping, never of completion.
    signals.push(...statuses.filter(s => /^CodeRabbit$/i.test(s.context) && !s.creator && /review\s+skipped/i.test(s.description ?? "")).map(s => ({ sha: pull.head.sha, state: s.state, description: s.description ?? "", trusted: true, date: s.created_at })));
    signals.push(...checks.check_runs.filter(c => c.app.slug === "coderabbitai" || c.app.slug === "coderabbit").map(c => ({ sha: c.head_sha, state: c.status === "completed" ? c.conclusion === "success" ? "completed" : c.conclusion ?? "unknown" : c.status, description: `${c.output.title ?? ""}\n${c.output.summary ?? ""}`, trusted: true, date: c.completed_at ?? c.started_at ?? "" })));
    // A submitted review containing a skip notice is not completion evidence.
    const completed = reviews.filter(r => !/review\s+skipped|review_skipped/i.test(r.body ?? ""));
    return reviewState(pull.head.sha, signals, completed.map(r => ({ sha: r.commit_id, user: r.user.login, state: r.state })), bot);
  } catch { return "判定不能（API の取得に失敗）"; }
}

async function guardParts(api: Github, state: State, options: Options, indices?: number[]): Promise<Pull[]> {
  const pulls: Pull[] = [];
  for (const [i, part] of state.parts.entries()) {
    if (indices && !indices.includes(i)) continue;
    if (!part.pr) continue;
    const pull = await api.pull(part.pr);
    if (pull.merged) {
      if (pull.user.login !== options.appBot || pull.head.sha !== part.sha || pull.base.ref !== "main") throw new Error("生成 PR が想定外の内容・対象でマージされています");
    } else {
      const expectedBase = i === state.merged ? "main" : state.parts[i - 1].branch;
      const allowedBases = new Set([expectedBase]);
      if (state.operation === "restack" && i === state.merged && i > 0) allowedBases.add(state.parts[i - 1].branch);
      if (pull.base.ref === "main" && !allowedBases.has("main") && i > 0 && state.parts[i - 1].pr) {
        const previous = pulls.find(p => p.number === state.parts[i - 1].pr) ?? await api.pull(state.parts[i - 1].pr!);
        if (previous.merged && previous.base.ref === "main" && previous.head.sha === state.parts[i - 1].sha && previous.user.login === options.appBot) allowedBases.add("main");
      }
      if (!allowedBases.has(pull.base.ref)) throw new Error("生成 PR の対象ブランチが手動変更されています");
      const [reviews, comments, reviewComments] = await Promise.all([
        api.list<{ user: { login: string }; state: string }>(`/pulls/${part.pr}/reviews`),
        api.list<Comment>(`/issues/${part.pr}/comments`),
        api.list<{ user: { login: string; type: string } }>(`/pulls/${part.pr}/comments`),
      ]);
      const old = {
        ...part, sha: part.previous ?? part.sha,
        body: pull.body === part.body ? part.body : part.previousBody ?? part.body,
        title: pull.title === part.title ? part.title : part.previousTitle ?? part.title,
      };
      // During recovery either the old or intended SHA is allowed, but the PR
      // description/title must still be the last recorded automation output.
      if (!canEdit(pull, { ...old, sha: pull.head.sha === part.sha ? part.sha : old.sha }, options.appBot!, reviews, comments, reviewComments)) throw new Error("人の編集・レビュー開始・Draft 解除・クローズを検出したため停止しました");
      if (pull.head.repo?.full_name !== api.repo) throw new Error("生成 PR のリポジトリが一致しません");
    }
    pulls.push(pull);
  }
  return pulls;
}

async function save(writer: Github, state: State, options: Options) {
  const body = encodeState(state, options.stateKey!);
  if (body.length > 60_000) throw new Error("操作記録がコメントのサイズ上限を超えています");
  const comment = await writer.comment(state.source, STATE_MARKER, body, options.appBot!);
  if (comment.user.login !== options.appBot) throw new Error("GitHub App の bot 名が一致しません");
}

async function publish(read: Github, git: Git, source: Pull, state: State, options: Options) {
  const writer = options.writer!;
  // Validate the entire journal before any ref mutation, including recovery.
  const guarded = await guardParts(read, state, options);
  if (guarded.some(p => p.merged && state.parts.slice(state.merged).some(part => part.pr === p.number))) throw new Error("マージ状態が処理中に変わりました。再評価が必要です");
  for (let i = state.merged; i < state.parts.length; i++) {
    const part = state.parts[i];
    const currentSource = await read.pull(source.number);
    if (currentSource.head.sha !== state.head) throw new Error("元 PR が処理中に更新されました");
    const main = await read.ref("main");
    if (main !== state.base) throw new Error("main が処理中に更新されました。再実行してください");
    const remote = await read.ref(part.branch);
    if (remote !== part.sha && remote !== part.previous) throw new Error("生成ブランチの SHA が操作記録と一致しません");
    const beforePush = await guardParts(read, state, options, [i]);
    if (beforePush.some(p => p.merged)) throw new Error("マージ状態が処理中に変わりました。ブランチ更新を停止しました");
    if (remote !== part.sha) git.push(read.repo, part.branch, part.sha, remote, writer.token);
    const base = i === state.merged ? "main" : state.parts[i - 1].branch;
    if (!part.pr) {
      const matches = await read.list<Pull>(`/pulls?state=all&head=${encodeURIComponent(read.repo.split("/")[0] + ":" + part.branch)}`);
      if (matches.length > 1) throw new Error("生成 PR が重複しています");
      let created = matches[0];
      if (created) {
        if (created.user.login !== options.appBot || created.head.sha !== part.sha || created.body !== part.body || created.title !== part.title || created.base.ref !== base || !created.draft || created.state !== "open") throw new Error("既存 PR が作成予定と一致しません");
      } else {
        created = await writer.api<Pull>("/pulls", "POST", { title: part.title, body: part.body, head: part.branch, base, draft: true });
      }
      part.pr = created.number;
      await save(writer, state, options);
    } else {
      const old = (await guardParts(read, state, options, [i]))[0];
      if (old.merged) throw new Error("マージ状態が処理中に変わりました。PR 更新を停止しました");
      // GitHub can automatically retarget after deleting a merged base branch.
      const permittedBases = new Set([base, i > 0 ? state.parts[i - 1].branch : "main"]);
      if (!permittedBases.has(old.base.ref)) throw new Error("生成 PR の対象ブランチが手動変更されています");
      const patch: { base?: string; body?: string; title?: string } = {};
      if (old.base.ref !== base) patch.base = base;
      if (old.body !== part.body) patch.body = part.body;
      if (old.title !== part.title) patch.title = part.title;
      if (Object.keys(patch).length) await writer.api(`/pulls/${part.pr}`, "PATCH", patch);
    }
    part.previous = null;
    delete part.previousBody; delete part.previousTitle;
    await save(writer, state, options);
  }
  state.operation = "idle";
  await save(writer, state, options);
}

function recoverObjects(git: Git, repo: string, state: State) {
  git.fetch(repo, state.base);
  git.fetch(repo, state.head);
  if (state.operation === "create" || state.operation === "update") {
    const regenerated = git.build(state.base, state.head, git.changes(state.base, state.head), state.parts.map(p => ({ paths: p.paths, reasons: p.reasons })), state.source);
    if (regenerated.some((sha, i) => sha !== state.parts[i].sha)) throw new Error("操作記録からコミットを再現できません");
  } else {
    let parent = state.base;
    for (let i = state.merged; i < state.parts.length; i++) {
      const part = state.parts[i];
      if (part.previous) {
        git.fetch(repo, part.previous);
        const tree = assertSha(git.text(["merge-tree", "--write-tree", `--merge-base=${git.parent(part.previous)}`, parent, part.previous]));
        const regenerated = git.commit(tree, parent, state.base, `Restack #${state.source}: remaining part ${i - state.merged + 1}`);
        if (regenerated !== part.sha) throw new Error("積み直しコミットを再現できません");
      } else git.fetch(repo, part.sha);
      parent = part.sha;
    }
  }
}

export async function reconcile(api: Github, git: Git, config: Config, number: number, options: Options): Promise<string> {
  const source = await api.pull(number);
  if (source.head.ref.startsWith("review-split/")) return "生成 PR は再分割しません";
  const review = await inspectReview(api, source, config.reviewBot);
  let message = `レビュー状態: **${review}**\n対象 HEAD: \`${source.head.sha}\`\n変更数: ${source.changed_files}（上限 ${config.fileLimit}）`;
  let state: State | undefined;
  let notify = source.changed_files > config.fileLimit || review === "省略";
  try {
    const records = (await api.list<Comment>(`/issues/${number}/comments`)).filter(c =>
      c.body.startsWith(STATE_MARKER) && (options.appBot ? c.user.login === options.appBot : c.user.type === "Bot"));
    if (records.length > 1) throw new Error("操作記録が重複しています");
    if (records[0]) {
      notify = true;
      if (!options.appBot || !options.stateKey) throw new Error("操作記録がありますが GitHub App または状態署名鍵の設定が不足しています");
      state = decodeState(records[0].body, options.stateKey, number);
    }
    if (state?.operation !== undefined && state.operation !== "idle") {
      if (!options.enabled || !options.writer) throw new Error("未完了の操作があります。自動作成を有効にして再実行してください");
      if (state.head !== source.head.sha) throw new Error("未完了操作の元 HEAD が更新されています。操作記録を確認してください");
      recoverObjects(git, api.repo, state);
      await publish(api, git, source, state, options);
    } else if (state) {
      const pulls = await guardParts(api, state, options);
      let merged = state.merged;
      while (merged < state.parts.length && pulls.find(p => p.number === state!.parts[merged].pr)?.merged) merged++;
      if (state.parts.slice(merged).some(part => pulls.find(p => p.number === part.pr)?.merged)) throw new Error("下流 PR が先にマージされています");
      if (merged > state.merged) {
        if (source.head.sha !== state.head) throw new Error("一部の取り込み後に元 PR が更新されています");
        if (!options.enabled || !options.writer) throw new Error("マージ後の積み直しには自動作成の有効化が必要です");
        const main = await api.ref("main");
        if (!main) throw new Error("main を取得できません");
        git.fetch(api.repo, main);
        for (let i = state.merged; i < merged; i++) {
          const pull = pulls.find(p => p.number === state!.parts[i].pr)!;
          if (!pull.merge_commit_sha) throw new Error("Squash merge のコミットを取得できません");
          git.fetch(api.repo, pull.merge_commit_sha);
          if (!git.isAncestor(pull.merge_commit_sha, main)) throw new Error("取り込み先が現在の main と一致しません");
          state.parts[i].merged = true;
        }
        for (const part of state.parts.slice(merged)) git.fetch(api.repo, part.sha);
        const commits = git.restack(state.parts.slice(merged).map(p => p.sha), main, main, number);
        state.parts.slice(merged).forEach((part, i) => { part.previous = part.sha; part.sha = commits[i]; });
        state.merged = merged; state.base = main; state.operation = "restack";
        await save(options.writer, state, options);
        await publish(api, git, source, state, options);
      } else if (source.head.sha !== state.head || source.base.sha !== state.base) {
        if (state.merged > 0) throw new Error("一部の取り込み後は元 PR の更新に自動追従しません");
        if (!options.enabled || !options.writer) throw new Error("元 PR が更新されています。自動作成は無効です");
        state = await prepare(api, git, source, config, state);
        await save(options.writer, state, options);
        await publish(api, git, source, state, options);
      }
    } else if (source.changed_files > config.fileLimit) {
      state = await prepare(api, git, source, config);
      const candidate = `\n\n分割候補: ${state.parts.length} グループ\n${state.parts.map((p, i) => `- ${i + 1}: ${p.paths.length} ファイル`).join("\n")}`;
      if (!options.enabled) { state = undefined; message += candidate + "\n自動作成は無効です。候補の分析のみ行いました。"; }
      else if (!options.writer || !options.stateKey || !options.appBot) { state = undefined; message += candidate + "\nGitHub App の設定が未完了のため作成していません。"; }
      else {
        await save(options.writer, state, options);
        await publish(api, git, source, state, options);
      }
    }
    if (state) message += `\n\n分割 PR（先頭から取り込み）:\n${state.parts.map(p => `- ${p.pr ? `#${p.pr}` : p.branch}${p.merged ? "（取り込み済み）" : ""}`).join("\n")}\n元の解析 HEAD: \`${state.head}\``;
  } catch (error) {
    notify = true;
    // Do not include REST response bodies, git stderr or tokens in notifications.
    const safe = error instanceof Error && !("stderr" in error) ? error.message : "Git 操作に失敗しました。競合・リモート更新を確認してください";
    message += `\n\n**自動処理を停止:** ${safe}`;
  }
  if (!notify) {
    await api.removeComment(number, NOTICE_MARKER, options.noticeBot ?? "github-actions[bot]");
    return "上限以下の PR の通常レビュー状態は通知しません";
  }
  const body = `${NOTICE_MARKER}\n${message}\n\nこの通知はレビュー完了の保証やマージ許可ではありません。`;
  await api.comment(number, NOTICE_MARKER, body, options.noticeBot ?? "github-actions[bot]");
  return body;
}

async function prepare(api: Github, git: Git, source: Pull, config: Config, old?: State): Promise<State> {
  if (source.state !== "open" || source.merged || source.base.ref !== "main" || source.head.repo?.full_name !== api.repo) throw new Error("同一リポジトリの main 向け未マージ PR のみ自動作成できます");
  if (source.mergeable !== true) throw new Error("コンフリクトまたはマージ可否未確定のため停止しました");
  git.fetch(api.repo, source.base.sha); git.fetch(api.repo, source.head.sha);
  if (!git.isAncestor(source.base.sha, source.head.sha)) throw new Error("最新 main を元ブランチへ取り込んでから再実行してください（main の変更を失わないため）");
  const changes = git.changes(source.base.sha, source.head.sha);
  if (changes.length !== source.changed_files || changes.length > config.maxFiles) throw new Error("差分取得が不完全またはファイル数上限を超えています");
  if (changes.some(c => [c.path, c.previous].some(p => p?.startsWith(".github/workflows/")))) throw new Error("Workflow ファイルの変更があるため自動作成を停止しました");
  const plan = splitPlan(changes, git.snapshot(git.tree(source.base.sha), config.maxSourceBytes), git.snapshot(git.tree(source.head.sha), config.maxSourceBytes), config.fileLimit);
  if (plan.stop) throw new Error(`${plan.stop}。候補: ${plan.groups.map(g => `${g.paths.length}ファイル`).join(" / ")}。${[...new Set(plan.groups.flatMap(g => g.reasons))].join("、")}`);
  if (plan.groups.length > config.maxGroups) throw new Error("生成 PR 数の上限を超えています");
  if (old && old.parts.length > plan.groups.length) throw new Error("分割数が減ったため停止しました。既存 Draft の整理が必要です");
  const commits = git.build(source.base.sha, source.head.sha, changes, plan.groups, source.number);
  const parts = plan.groups.map((group, i): Part => ({
    branch: `review-split/${source.number}/${i + 1}`, sha: commits[i], previous: old?.parts[i]?.sha ?? null,
    paths: group.paths, reasons: group.reasons, pr: old?.parts[i]?.pr, merged: false,
    body: partBody(source, i, plan.groups.length, group),
    title: `Split #${source.number} (${i + 1}/${plan.groups.length})`,
    previousBody: old?.parts[i]?.body, previousTitle: old?.parts[i]?.title,
  }));
  if (parts.some(p => p.body.length > 60_000)) throw new Error("生成 PR 本文がサイズ上限を超えています");
  return { version: 1, source: source.number, base: source.base.sha, head: source.head.sha, parts, merged: 0, operation: old ? "update" : "create" };
}
