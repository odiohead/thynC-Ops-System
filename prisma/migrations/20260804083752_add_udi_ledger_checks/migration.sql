-- UDI 입출고대장 (projects/inventory_udi_ledger_design.md) P4
-- '동일 LOT NO 제품 출고완료' 수동 체크 — 입고 전표 × LOT 단위 (전표 1건이 복수 LOT으로 분해될 수 있어 복합키)

CREATE TABLE IF NOT EXISTS udi_ledger_checks (
  transaction_id INT          NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
  lot_no         VARCHAR(100) NOT NULL DEFAULT '',
  checked        BOOLEAN      NOT NULL DEFAULT false,
  checked_by_id  TEXT                  REFERENCES users(id) ON DELETE SET NULL,
  checked_at     TIMESTAMP(3),
  PRIMARY KEY (transaction_id, lot_no)
);
