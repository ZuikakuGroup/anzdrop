import LegalLayout, { LegalSection, LegalParagraph, LegalLink } from "@/components/legal/LegalLayout";
import { LEGAL_LAST_UPDATED, OPERATOR, OPERATOR_GROUP_LABEL } from "@/lib/legal/constants";

export default function TermsPage({ showChrome = true }: { showChrome?: boolean } = {}) {
  return (
    <LegalLayout showChrome={showChrome} title="利用規約" lastUpdated={LEGAL_LAST_UPDATED}>
      <LegalSection heading="第1条（適用）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>本規約は、{OPERATOR_GROUP_LABEL}（以下「運営者」といいます。）が提供するファイル共有サービス「Anzdrop」（以下「本サービス」といいます。）の利用条件を定めるものです。</li>
          <li>本サービスを利用する者（以下「利用者」といいます。）は、本規約に同意したうえで本サービスを利用するものとします。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第2条（ファイルの保存および削除）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>共有ファイルは、設定された保存期間の満了またはダウンロード回数の上限到達により削除されます。</li>
          <li>利用者は、自己の責任においてファイルの原本を管理するものとします。</li>
          <li>運営者は、削除されたファイルの復元義務を負いません。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第3条（アカウント）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>有料プランの利用には、アカウントの登録が必要です。</li>
          <li>利用者は、自己の責任においてアカウントID、パスワード、リカバリーコードその他の認証情報を管理するものとします。</li>
          <li>認証情報の管理不十分または第三者による不正使用に起因する損害については、運営者に帰責事由がある場合を除き、利用者が責任を負います。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第4条（料金および支払い）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>利用者は、有料プランの利用にあたり、運営者が定める利用料金を所定の方法により支払うものとします。</li>
          <li>利用料金、支払方法、支払時期その他の取引条件は、特定商取引法に基づく表記および申込時に提示する条件に従うものとします。</li>
          <li>月額契約は、利用者が解約手続きを行うまで自動的に更新されます。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第5条（解約および返金）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>利用者は、運営者所定の方法により、いつでも有料プランを解約できます。</li>
          <li>解約の効力は、支払済みの契約期間の満了時に生じるものとします。</li>
          <li>支払済みの利用料金については、法令により返金が必要な場合を除き、返金しません。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第6条（禁止事項）">
        <LegalParagraph>
          利用者は、本サービスの利用にあたり、以下の行為をしてはなりません。
        </LegalParagraph>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>法令または公序良俗に違反する行為</li>
          <li>児童の性的搾取に関するコンテンツのアップロードまたは共有</li>
          <li>第三者の著作権、商標権、肖像権、プライバシーその他の権利を侵害する行為</li>
          <li>マルウェアその他の有害なプログラムのアップロードまたは共有</li>
          <li>第三者の個人情報を不当に公開または拡散する行為</li>
          <li>スパム、フィッシングその他の不正行為</li>
          <li>不正アクセスまたは脆弱性を悪用する行為</li>
          <li>本サービスの設備に過度な負荷を与える行為</li>
          <li>本サービスの運営を妨害する行為</li>
          <li>その他これらに準ずる行為</li>
        </ul>
      </LegalSection>
      <LegalSection heading="第7条（共有ファイルの取扱い）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>共有ファイルに関する権利は、利用者または正当な権利者に帰属します。</li>
          <li>利用者は、ファイルのアップロードおよび共有について必要な権利を有するものとし、その内容について責任を負います。</li>
          <li>運営者は、共有ファイルが法令または本規約に違反すると合理的に判断した場合、事前の通知なく当該ファイルの共有を停止または削除することができます。</li>
          <li>権利侵害に関する申立ては、権利者本人またはその代理人から<LegalLink href="https://anzdrop.com/report/rights">権利者向け通報フォーム</LegalLink>を通じて受け付けます。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第8条（サービスの変更・中断・終了）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>運営者は、運営上必要がある場合、本サービスの全部または一部を変更、中断または終了することができます。</li>
          <li>本サービスの提供を終了する場合は、合理的な期間を設けて事前に周知するものとします。ただし、緊急その他やむを得ない事情がある場合は、この限りではありません。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第9条（免責および損害賠償）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>運営者は、本サービスの完全性、正確性、可用性および特定の目的への適合性を保証しません。</li>
          <li>運営者の責任によらない認証情報の紛失、データの消失その他の事由によって利用者に生じた損害について、運営者は責任を負いません。</li>
          <li>運営者の軽過失により利用者に損害が生じた場合、運営者が負う損害賠償責任は、現実に生じた通常かつ直接の損害に限るものとします。有料プランについては、損害発生前1か月間に当該利用者が支払った利用料金を上限とします。</li>
          <li>事業としてまたは事業のために本サービスを利用する者に対しては、運営者の軽過失による損害賠償責任を負いません。</li>
          <li>前各項の免責および責任の制限は、運営者の故意もしくは重大な過失による場合、または法令により認められない場合には適用しません。</li>
          <li>利用者間または利用者と第三者との間で生じた紛争は、当事者の責任および費用において解決するものとします。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第10条（知的財産権）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>本サービスに関する知的財産権は、運営者または正当な権利者に帰属します。</li>
          <li>オープンソースとして公開されているソフトウェアの利用条件は、当該ソフトウェアに適用されるライセンスに従うものとします。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第11条（個人情報の取扱い）">
        <LegalParagraph>
          本サービスにおける個人情報その他の利用者情報の取扱いは、運営者が別途定めるプライバシーポリシーに従います。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="第12条（本規約の変更）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>運営者は、民法第548条の4その他の関係法令に従い、本規約を変更することができます。</li>
          <li>本規約を変更する場合は、変更後の内容および効力発生日を事前に周知します。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第13条（準拠法および管轄）">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/70 marker:text-ink/60">
          <li>本規約の準拠法は日本法とします。</li>
          <li>本サービスまたは本規約に関して運営者と利用者との間に生じた紛争については、法令に別段の定めがある場合を除き、横浜地方裁判所または藤沢簡易裁判所を第一審の専属的合意管轄裁判所とします。</li>
        </ol>
      </LegalSection>
      <LegalSection heading="第14条（お問い合わせ）">
        <LegalParagraph>
          本規約に関するお問い合わせは、<LegalLink href={`https://anzdrop.com${OPERATOR.contactFormPath}`}>お問い合わせフォーム</LegalLink>または<LegalLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</LegalLink>にて受け付けます。
        </LegalParagraph>
      </LegalSection>
    </LegalLayout>
  );
}
