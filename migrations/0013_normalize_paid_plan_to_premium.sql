-- lib/plan.tsのPlan型を"free"|"paid"から"free"|"standard"|"premium"へ拡張したのに伴い、
-- 旧値"paid"(仕様上Premium相当)をDB上でも正規化する。コード側のnormalizeStoredPlan()
-- による防御的エイリアスと併用し、マイグレーション適用前後のデプロイ順序に対して安全にする。
UPDATE accounts SET plan = 'premium' WHERE plan = 'paid';
