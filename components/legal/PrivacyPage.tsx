import LegalLayout, { LegalSection, LegalParagraph, LegalLink, LegalList } from "@/components/legal/LegalLayout";
import { LEGAL_LAST_UPDATED, OPERATOR_GROUP_LABEL, OPERATOR } from "@/lib/legal/constants";

export default function PrivacyPage({ showChrome = true }: { showChrome?: boolean } = {}) {
  return (
    <LegalLayout showChrome={showChrome} title="プライバシーポリシー" lastUpdated={LEGAL_LAST_UPDATED}>
      <LegalSection heading="基本方針">
        <LegalParagraph>
          {OPERATOR_GROUP_LABEL}（以下「運営者」といいます。）は、ファイル共有サービス「Anzdrop」（以下「本サービス」といいます。）における利用者情報の取扱いについて、本ポリシーを定めます。
        </LegalParagraph>
        <LegalParagraph>
          本サービスでは、ファイルおよびファイル名の暗号化と復号を利用者のブラウザ上で行います。ファイルの復号鍵は共有URLを通じて受け渡され、サーバーには送信されません。パスワード付き共有の場合は、復号に必要な情報をパスワードで保護したうえでサーバーに保存します。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="取得する情報">
        <LegalParagraph>
          運営者は、本サービスの提供に必要な範囲で利用者の情報を取得します。
        </LegalParagraph>
        <h3 className="pt-3 text-base font-bold">ファイル共有に関する情報</h3>
        <LegalParagraph>
          ファイル共有機能の利用に際して、以下の情報を取得します。
        </LegalParagraph>
        <LegalList
          items={[
            "暗号化されたファイルおよびファイル名",
            "ファイルサイズ、作成日時、有効期限",
            "ダウンロード回数",
            "共有の一時停止状態",
            "パスワード保護の有無",
          ]}
        />
        <h3 className="pt-3 text-base font-bold">アカウントに関する情報</h3>
        <LegalParagraph>
          有料プランを利用する場合は、以下の情報を取得します。
        </LegalParagraph>
        <LegalList
          items={[
            "アカウントID",
            "契約プランおよび有効期限",
            "決済事業者が発行する顧客IDおよびサブスクリプションID",
            "決済履歴",
            "ログインの連続失敗回数",
          ]}
        />
        <LegalParagraph>
          また、パスワードおよびリカバリーコードは復元できない形式に変換して保存します。パスキーや認証アプリを設定した場合は、認証に必要な公開鍵、識別子、登録情報、検証情報および暗号化された認証情報を取得します。
        </LegalParagraph>
        <h3 className="pt-3 text-base font-bold">通報・お問い合わせに関する情報</h3>
        <LegalParagraph>
          通報フォームでは、対象の共有ID、通報理由およびカテゴリを取得します。権利者からの通報については、申立者名、連絡先メールアドレスおよび権利の種類も取得します。
        </LegalParagraph>
        <LegalParagraph>
          お問い合わせフォームでは、返信先メールアドレス、件名、本文および任意で入力された氏名を取得します。
        </LegalParagraph>
        <h3 className="pt-3 text-base font-bold">サービスの利用状況に関する情報</h3>
        <LegalParagraph>
          サービスの利用状況を把握するため、以下の情報を取得します。
        </LegalParagraph>
        <LegalList
          items={[
            "ブラウザに割り当てられた識別番号",
            "利用した画面および機能",
            "ファイルサイズの区分",
            "アップロード・ダウンロードの成否",
            "流入経路および参照元サイトのドメイン",
            "端末およびブラウザの種類",
          ]}
        />
        <LegalParagraph>
          また、本サービスの提供に伴い、IPアドレス等の通信情報がCloudflareによって処理されます。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="利用目的">
        <LegalParagraph>
          運営者は、取得した情報を以下の目的で利用します。
        </LegalParagraph>
        <LegalList
          items={[
            "本サービスおよび有料プランの提供・運営",
            "決済処理および契約情報の管理",
            "通報・お問い合わせへの対応",
            "不正利用の防止および違法・不適切な利用への対応",
            "障害の調査、サービスの維持・改善",
          ]}
        />
      </LegalSection>
      <LegalSection heading="外部サービスの利用">
        <LegalParagraph>
          運営者は、本サービスの運営にあたり、以下の外部事業者が提供するサービスを利用しています。
        </LegalParagraph>
        <h3 className="pt-3 text-base font-bold">Cloudflare, Inc.</h3>
        <LegalParagraph>
          本サービスのホスティング、データベース、ファイルの保管および不正利用対策にCloudflareのサービスを利用しています。これに伴い、IPアドレス等の通信情報がCloudflareによって処理されます。
        </LegalParagraph>
        <h3 className="pt-3 text-base font-bold">Stripe, Inc.</h3>
        <LegalParagraph>
          有料プランのクレジットカード決済にStripeを利用しています。決済に必要なカード情報はStripeが取得し、運営者のサーバーには保存されません。
        </LegalParagraph>
        <h3 className="pt-3 text-base font-bold">Discord, Inc.</h3>
        <LegalParagraph>
          運営者は内部連絡にDiscordを利用しています。通報やお問い合わせへの対応に必要な情報をDiscord上で取り扱う場合があります。
        </LegalParagraph>
        <LegalParagraph>
          各事業者による情報の取扱いについては、それぞれのプライバシーポリシーが適用されます。
        </LegalParagraph>
        <LegalParagraph>
          このほか、法令に基づく場合、または人の生命、身体もしくは財産の保護のために必要がある場合は、必要な範囲で情報を第三者に提供することがあります。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="Cookie等の利用">
        <LegalParagraph>
          本サービスでは、ログイン状態の維持および認証処理のためにCookieを使用します。
        </LegalParagraph>
        <LegalParagraph>
          また、サービスの利用状況を把握するため、ブラウザに識別番号を保存します。この識別番号は氏名やメールアドレスとは結び付けず、利用状況の集計に使用します。ブラウザに保存された情報が削除された場合は、新たな識別番号が発行されます。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="情報の保存期間">
        <LegalParagraph>
          共有ファイルおよび関連情報は、利用者が設定した保存期間の経過またはダウンロード回数の上限到達により、自動的に削除されます。完了しなかったアップロードに関する一時情報は、作成から24時間経過後に削除します。
        </LegalParagraph>
        <LegalParagraph>
          アカウント情報は、アカウントが存在する期間中保存します。パスキーおよび認証アプリの設定情報は、設定の解除またはアカウントの復旧まで保存し、認証途中の一時情報は有効期限の経過後に削除します。
        </LegalParagraph>
        <LegalParagraph>
          通報およびお問い合わせの記録は、対応履歴の管理や再発防止のため、対応完了後も一定期間保存する場合があります。
        </LegalParagraph>
        <LegalParagraph>
          サービスの利用状況に関する個々の記録は1年間保存します。個人を特定できない形式に集計した統計情報については、24か月以上保存する場合があります。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="安全管理措置">
        <LegalParagraph>
          運営者は、取得した情報への不正アクセス、漏えい、滅失または毀損を防止するため、必要な安全管理措置を講じます。
        </LegalParagraph>
        <LegalParagraph>
          本サービスでは、ファイルおよびファイル名の暗号化、認証情報の保護、通信の暗号化等を実施しています。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="ユーザーの権利">
        <LegalParagraph>
          利用者は、運営者が保有する自身の個人情報について、法令に定める範囲で開示、訂正、利用停止、削除等を請求できます。
        </LegalParagraph>
        <LegalParagraph>
          ただし、共有ファイルの内容は運営者が復号できないため、その内容の開示および訂正には対応できません。
        </LegalParagraph>
        <LegalParagraph>
          これらの請求および共有ファイルの削除に関するお問い合わせは、<LegalLink href={`https://anzdrop.com${OPERATOR.contactFormPath}`}>お問い合わせフォーム</LegalLink>から受け付けます。共有ファイルについては、<LegalLink href="https://anzdrop.com/report">通報フォーム</LegalLink>からもご連絡いただけます。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="お問い合わせ先">
        <LegalParagraph>
          本ポリシーおよび個人情報の取扱いに関するお問い合わせは、{OPERATOR_GROUP_LABEL}が<LegalLink href={`https://anzdrop.com${OPERATOR.contactFormPath}`}>お問い合わせフォーム</LegalLink>またはメールアドレス<LegalLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</LegalLink>で受け付けます。
        </LegalParagraph>
      </LegalSection>
      <LegalSection heading="本ポリシーの変更">
        <LegalParagraph>
          運営者は、必要に応じて本ポリシーを変更することがあります。変更後の内容は、本ページに掲載した時点から効力を生じます。
        </LegalParagraph>
      </LegalSection>
    </LegalLayout>
  );
}
