-- New accounts (first Discord login) should start with 1000 CRL coins
-- instead of 0. Only affects future inserts — existing rows are untouched.
alter table accounts alter column crl_coins set default 1000;
