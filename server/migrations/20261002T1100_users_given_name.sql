-- Имя для приветствия берём из givenName, не угадываем порядок ФИО.
ALTER TABLE users ADD COLUMN given_name text;
