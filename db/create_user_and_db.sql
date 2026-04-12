-- Rode como um usuário admin (ex: postgres) no psql.
DO
$$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'the_money') THEN
    CREATE ROLE the_money WITH LOGIN PASSWORD 'the_money';
  END IF;
END
$$;

ALTER ROLE the_money CREATEDB;

CREATE DATABASE the_money OWNER the_money;
