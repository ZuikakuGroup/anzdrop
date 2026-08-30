import LegalLayout, {
  LegalSection,
  LegalParagraph,
  LegalList,
} from "@/components/legal/LegalLayout";
import {
  LEGAL_LAST_UPDATED,
  OPERATOR,
  OPERATOR_ENTITY_LABEL,
} from "@/lib/legal/constants";

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="プライバシーポリシー"
      description="Anzdrop(以下「本サービス」)における情報の取扱いについて定めます。"
      lastUpdated={LEGAL_LAST_UPDATED}
    >
      <LegalSection heading="基本方針">
        <LegalParagraph>
          本サービスは、エンドツーエンド暗号化を中核とする設計方針のもと、サーバー側に保持する情報を可能な限り少なくすることを重視しています。ファイルの暗号化・復号はユーザーのブラウザ内で行われ、当方のサーバーは、ファイルの内容および元のファイル名を保持せず、閲覧することもできません。ファイルの復号鍵は共有URLのフラグメント(#以降)にのみ含まれ、サーバーへ送信されません。共有にパスワードを設定した場合、サーバーには、パスワードから導出した鍵で暗号化された状態の復号鍵とそのソルトのみが保存され、パスワードそのものは保存されないため、当方はファイルを復号できません。また、本サービスは、アカウント登録やファイル共有の機能においてメールアドレスを要求しません(お問い合わせ等でユーザーがご自身の判断で送信された連絡先を除きます)。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="取得する情報">
        <LegalParagraph>
          本サービスは、機能の提供のために必要な範囲で以下の情報を取り扱います。
        </LegalParagraph>
        <LegalList
          items={[
            "ファイル共有に関する情報: 暗号化済みのファイル本体、暗号化済みのファイル名、ファイルサイズ、作成日時、有効期限、ダウンロード回数、共有の一時停止状態、パスワード保護の有無、およびパスワードを設定した場合は暗号化された状態の鍵とそのソルト。復号鍵そのものは共有URLのフラグメント(#以降)にのみ含まれ、ブラウザからサーバーへ送信されないため、当方のアプリケーションログ等にも残りません。",
            "アカウントに関する情報(有料プラン利用時のみ): アカウントID、パスワードのハッシュ値、リカバリーコードのハッシュ値、現在のプランと有効期限、決済事業者が発行する顧客ID・サブスクリプションID、ビットコイン決済の履歴、ログインの連続失敗回数。パスワード・リカバリーコードの平文は保持しません。",
            "通報フォームの入力内容: 対象の共有ID、通報理由、カテゴリ。権利者向けフォームではこれに加えて申立者名、連絡先メールアドレス、権利の種類。",
            "お問い合わせフォームの入力内容: 氏名(任意)、返信先メールアドレス、件名、本文。",
            "通信に伴う技術的情報: 本サービスはCloudflareの基盤上で動作しており、通信の過程でIPアドレス等の技術的情報がCloudflareにより処理されます(下記「外部サービス」参照)。",
          ]}
        />
        <LegalParagraph>
          通報・お問い合わせの自由記述欄は、復号鍵らしき文字列が誤って含まれていた場合に、保存前に自動的に除去する処理を行っています。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="利用目的">
        <LegalList
          items={[
            "ファイル共有機能および有料プランの提供・維持のため",
            "料金の決済、契約状態の管理のため",
            "通報・お問い合わせへの対応、違法・不適切な利用への対応のため",
            "不正アクセスや総当たり攻撃などの不正利用の防止のため",
            "本サービスの障害対応・改善のため",
          ]}
        />
      </LegalSection>

      <LegalSection heading="外部サービス(第三者への提供・委託)">
        <LegalParagraph>
          本サービスは、以下の外部サービスを利用しています。各サービスにおける情報の取扱いは、それぞれの提供事業者のプライバシーポリシーに従います。
        </LegalParagraph>
        <LegalList
          items={[
            "Cloudflare, Inc. — ホスティング、アプリケーション実行基盤、データベース、ファイルストレージ、Bot対策(Turnstile)、管理画面の認証。通信に伴いIPアドレス等が処理されます。Turnstileの検証において、当方はユーザーのIPアドレスを当方サーバーから外部へ転送しない設定にしています。",
            "Stripe, Inc. — クレジットカード決済。カード番号等の情報はユーザーのブラウザから直接Stripeへ送信され、当方のサーバーを経由・保存しません。",
            "OpenNode(ビットコイン決済。現在準備中) — 暗号資産による決済処理。",
          ]}
        />
        <LegalParagraph>
          上記のほか、法令に基づく場合、または人の生命・身体・財産の保護のために必要がある場合には、必要な範囲で情報を提供することがあります。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="Cookie等の利用">
        <LegalParagraph>
          本サービスは、有料プランにログインした状態を維持するためにのみ、セッションCookie(anzdrop_session)を使用します。このCookieはHttpOnly・Secure・SameSite=Strict属性を付与しており、有効期間は約30日です。本サービスは、広告や行動追跡を目的としたCookie、および第三者によるアクセス解析ツールを使用していません。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="保存期間">
        <LegalList
          items={[
            "共有・ファイル: 設定された保存期間の経過、またはダウンロード回数の上限到達により自動的に削除されます。",
            "完了しなかったアップロードのセッション: 作成から24時間経過後に自動的に削除されます。",
            "アカウント情報: アカウントが存在する間、保持されます。",
            "通報・お問い合わせの記録: 対応の記録および再発防止のため、対応完了後も一定期間保持することがあります。",
          ]}
        />
      </LegalSection>

      <LegalSection heading="安全管理措置">
        <LegalList
          items={[
            "ファイルおよびファイル名は、ユーザーのブラウザ内でAES-256-GCMにより暗号化されてからアップロードされます。",
            "パスワード・リカバリーコードはハッシュ化して保存し、平文は保持しません。",
            "通信はTLSにより保護されます。",
            "管理画面へのアクセスはCloudflare Accessによる認証で制限されています。",
          ]}
        />
      </LegalSection>

      <LegalSection heading="ユーザーの権利">
        <LegalParagraph>
          ユーザーは、当方が保有する自己の情報について、開示・訂正・利用停止・削除等を請求できます。ご請求は下記のお問い合わせ先までご連絡ください。ただし、暗号化されたファイルの内容については、当方が復号できない設計であるため、内容の開示・訂正には応じられません。共有の削除をご希望の場合は、通報フォームまたはお問い合わせフォームからご連絡ください。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="お問い合わせ先">
        <LegalParagraph>
          本ポリシーおよび情報の取扱いに関するお問い合わせは、{OPERATOR_ENTITY_LABEL}
          (個人情報保護管理責任者: {OPERATOR.representative})まで、本サイトのお問い合わせフォーム(
          {OPERATOR.contactFormPath})または {OPERATOR.email}
          にてお願いします。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="本ポリシーの変更">
        <LegalParagraph>
          当方は、必要に応じて本ポリシーを変更することがあります。変更後の内容は、本ページに掲載した時点から効力を生じます。
        </LegalParagraph>
      </LegalSection>
    </LegalLayout>
  );
}
