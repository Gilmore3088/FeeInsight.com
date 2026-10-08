-- When a user proved they own their account email (clicked the confirmation link, or reset
-- their password through an emailed link). Null until then. The account page lists reports
-- bought with that email only once it is set. Adds a nullable column; changes no rows.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
