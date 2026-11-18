-- thync-usage-agent 용 조회 전용 DB 계정 (MySQL 8)
--   sudo mysql < create-db-user.sql      (비밀번호를 아래 두 줄에 똑같이 넣는다)
--
-- 이 계정은 사용량 수집에 필요한 테이블만 SELECT 할 수 있다.
-- 환자 테이블(patient*, his_*), 신호 데이터, 사용자 계정 테이블에는 권한이 없다.

CREATE USER IF NOT EXISTS 'thync_usage_ro'@'localhost' IDENTIFIED BY '여기에_비밀번호';
CREATE USER IF NOT EXISTS 'thync_usage_ro'@'127.0.0.1' IDENTIFIED BY '여기에_비밀번호';

GRANT SELECT ON thync.organization     TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT SELECT ON thync.ward             TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT SELECT ON thync.sickbed          TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT SELECT ON thync.device_register  TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT SELECT ON thync.device_info      TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT SELECT ON thync.measurement_info TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT SELECT ON thync.global_setting   TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';

-- 기기 상태 이력은 연도별 테이블(device_status_info_<연도>)이고, 해마다 제품이 새 테이블을 만든다.
-- 아직 없는 테이블에는 SELECT 만 줄 수 없어서, CREATE 와 함께 준 뒤 CREATE 를 바로 거둔다 → SELECT 만 남는다.
-- 이렇게 2040년 테이블까지 미리 주므로, 해가 바뀌어도 이 파일을 다시 실행할 필요가 없다.

GRANT CREATE, SELECT ON thync.device_status_info_2020 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2020 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2021 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2021 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2022 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2022 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2023 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2023 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2024 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2024 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2025 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2025 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2026 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2026 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2027 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2027 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2028 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2028 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2029 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2029 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2030 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2030 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2031 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2031 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2032 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2032 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2033 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2033 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2034 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2034 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2035 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2035 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2036 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2036 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2037 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2037 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2038 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2038 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2039 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2039 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
GRANT CREATE, SELECT ON thync.device_status_info_2040 TO 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';
REVOKE CREATE ON thync.device_status_info_2040 FROM 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1';

SHOW GRANTS FOR 'thync_usage_ro'@'localhost';
