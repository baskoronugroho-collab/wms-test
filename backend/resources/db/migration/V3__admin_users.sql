-- Real admin users.
--
-- The app never auto-provisions: an email Google authenticates but this table
-- does not know gets a 403 telling them to ask an admin (auth.py). SSO answers
-- *who*; role and site access are the app's own logic, and they start here.
--
-- default_site_id 99 is MAC-TRN, the training site — so a first sign-in lands
-- somewhere that cannot touch real stock.

INSERT INTO users (email, name, role, default_site_id, locale) VALUES
  ('baskoro.nugroho@ninjavan.co',   'Baskoro Nugroho',   'admin', 99, 'id'),
  ('adila.kestibawani@ninjavan.co', 'Adila Kestibawani', 'admin', 99, 'id');

-- Admins already see every site in auth.py, so these rows are belt-and-braces:
-- they keep site access correct if either account is later demoted to
-- supervisor or staff, where user_sites becomes the authority.
INSERT INTO user_sites (user_id, site_id)
SELECT u.id, s.id
FROM users u
CROSS JOIN sites s
WHERE u.email IN ('baskoro.nugroho@ninjavan.co', 'adila.kestibawani@ninjavan.co')
ON DUPLICATE KEY UPDATE user_sites.user_id = user_sites.user_id;
