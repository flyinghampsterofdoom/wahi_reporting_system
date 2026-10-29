-- Remove the UI's fixed deadline only from still-active connection grants.
-- Never enable a disabled grant or revive an already-expired authorization.
-- Provider content rights, OAuth state and discovery lifetimes remain unchanged.
WITH previous AS (
 SELECT location_id, environment, connection_expires_at
 FROM wahi_v2.review_provider_settings
 WHERE provider='google' AND connection_enabled
   AND connection_expires_at>CURRENT_TIMESTAMP
), changed AS (
 UPDATE wahi_v2.review_provider_settings p
 SET connection_expires_at=NULL
 FROM previous b
 WHERE p.location_id=b.location_id AND p.environment=b.environment AND p.provider='google'
 RETURNING p.location_id,p.environment,b.connection_expires_at
)
INSERT INTO wahi_v2.review_audit(location_id,actor_id,event,details,recorded_at)
SELECT location_id,'persistent-authorization-migration',
 'google_connection_deadline_removed',
 jsonb_build_object('environment',environment,'previousExpiresAt',connection_expires_at,
                    'scope','OAuth and merchant metadata only','contentEnabled',false),
 CURRENT_TIMESTAMP FROM changed;
