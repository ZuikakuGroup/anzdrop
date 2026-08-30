import LegalLayout, {
  LegalSection,
  LegalParagraph,
  LegalLink,
  LegalList,
} from "@/components/legal/LegalLayout";
import {
  LEGAL_LAST_UPDATED,
  OPERATOR,
  OPERATOR_GROUP_LABEL,
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
          本サービスは、お預かりする情報をできる限り少なくすることを大切にしています。ファイルの暗号化と復号は、すべてお使いのブラウザの中で行われます。そのため当方のサーバーは、ファイルの中身も、元のファイル名も、知ることができません。
        </LegalParagraph>
        <LegalParagraph>
          ファイルを開くための鍵は、共有用のURLの一部としてのみ受け渡され、サーバーには送られません。共有にパスワードを設定した場合は、ファイルを開くための情報を、そのパスワードでしか使えない形に保護したうえでサーバーに保存しますが、パスワードそのものは保存しません。そのため、いずれの場合も当方がお預かりしたファイルを開くことはできません。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="取得する情報">
        <LegalParagraph>
          本サービスは、機能を提供するために必要な範囲で、次の情報を取り扱います。
        </LegalParagraph>
        <LegalList
          items={[
            "ファイル共有：暗号化されたファイル本体、暗号化されたファイル名、ファイルサイズ、作成日時、有効期限、ダウンロード回数、共有の一時停止の状態、パスワード保護の有無",
            "有料プラン利用時のみ：アカウントID、現在のプランと有効期限、決済事業者が発行する顧客IDおよびサブスクリプションID、ビットコイン決済の履歴、ログインの連続失敗回数",
            "有料プランのパスワードとリカバリーコード：そのままの形では保存せず、元に戻せない値に変換して保存します",
            "通報フォーム：対象の共有ID、通報理由、カテゴリ",
            "権利者向けの通報フォーム：上記に加えて、申立者名、連絡先メールアドレス、権利の種類",
            "お問い合わせフォーム：返信先メールアドレス、件名、本文、およびご希望の場合はお名前",
            "通信に伴う技術的な情報：本サービスはCloudflareの仕組みの上で動いており、通信の際にIPアドレスなどがCloudflareで処理されます",
          ]}
        />
        <LegalParagraph>
          通報・お問い合わせの入力欄に、ファイルを開くための鍵にあたる文字列が誤って含まれていた場合は、保存する前に自動的に取り除きます。
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
            "Cloudflare, Inc. — ホスティング、アプリケーションの実行、データベース、ファイルの保管、迷惑行為対策(Turnstile)、管理画面の認証。通信に伴いIPアドレスなどが処理されます。迷惑行為対策の確認において、当方はユーザーのIPアドレスを当方のサーバーから外部へ渡さない設定にしています。",
            "Stripe, Inc. — クレジットカード決済。カード番号などの情報はユーザーのブラウザから直接Stripeへ送信され、当方のサーバーを経由・保存しません。",
            "OpenNode(ビットコイン決済。現在準備中) — 暗号資産による決済処理。",
            "Discord, Inc. — 運営チーム内の連絡に利用しています。通報・お問い合わせへの対応の過程で、その内容がDiscord上でも取り扱われることがあります。",
          ]}
        />
        <LegalParagraph>
          上記のほか、法令に基づく場合、または人の生命・身体・財産の保護のために必要がある場合には、必要な範囲で情報を提供することがあります。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="Cookie等の利用">
        <LegalParagraph>
          本サービスは、有料プランにログインした状態を保つためにのみ、Cookie(クッキー)を使用します。このCookieの有効期限は約30日です。本サービスは、広告や行動追跡を目的としたCookie、および第三者によるアクセス解析ツールを使用していません。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="保存期間">
        <LegalList
          items={[
            "共有・ファイル：設定された保存期間の経過、またはダウンロード回数の上限到達により自動的に削除されます。",
            "完了しなかったアップロードのセッション：作成から24時間経過後に自動的に削除されます。",
            "アカウント情報：アカウントが存在する間、保持されます。",
            "通報・お問い合わせの記録：対応の記録および再発防止のため、対応完了後も一定期間保持することがあります。",
          ]}
        />
      </LegalSection>

      <LegalSection heading="安全管理措置">
        <LegalList
          items={[
            "ファイルとファイル名は、お使いのブラウザの中で暗号化してからアップロードされます。",
            "パスワードとリカバリーコードは、元に戻せない値に変換して保存します。",
            "本サービスとの通信は暗号化されます。",
          ]}
        />
      </LegalSection>

      <LegalSection heading="ユーザーの権利">
        <LegalParagraph>
          ユーザーは、当方が保有するご自身の情報について、開示・訂正・利用停止・削除などを請求できます。ご請求は下記のお問い合わせ先までご連絡ください。ただし、暗号化されたファイルの中身については、当方が開くことのできない仕組みのため、開示・訂正には応じられません。共有の削除をご希望の場合は、
          <LegalLink href="/report">通報フォーム</LegalLink>または
          <LegalLink href={OPERATOR.contactFormPath}>お問い合わせフォーム</LegalLink>
          からご連絡ください。
        </LegalParagraph>
      </LegalSection>

      <LegalSection heading="お問い合わせ先">
        <LegalParagraph>
          本ポリシーおよび情報の取扱いに関するお問い合わせは、{OPERATOR_GROUP_LABEL}
          まで、
          <LegalLink href={OPERATOR.contactFormPath}>お問い合わせフォーム</LegalLink>
          、またはメールアドレス{" "}
          <LegalLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</LegalLink>
          {" "}までご連絡ください。
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
