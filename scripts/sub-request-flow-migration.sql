-- Sub request flow redesign: requests are now accepted/rejected by the opposing
-- team. A rejected request can be escalated by the requesting team to staff, who
-- can approve it. Adds the 'escalated' status.
alter table sub_requests drop constraint if exists sub_requests_status_check;
alter table sub_requests
  add constraint sub_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'escalated'));
