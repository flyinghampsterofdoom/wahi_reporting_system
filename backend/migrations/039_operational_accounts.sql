-- Existing identities retain their IDs, credentials and recovery policy.
ALTER TABLE wahi_v2.users
 ADD COLUMN account_type TEXT NOT NULL DEFAULT 'named'
 CHECK (account_type IN ('named','operational'));
ALTER TABLE wahi_v2.users ADD CONSTRAINT users_operational_account
 CHECK (account_type <> 'operational' OR
        (email IS NULL AND email_verified_at IS NULL AND role <> 'ADMIN'));
