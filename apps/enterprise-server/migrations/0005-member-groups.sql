-- Identity-owned grouping, not a resource grant or another runtime registry.
create table haas.member_groups (
  tenant_id text not null references haas.tenants (tenant_id),
  group_id uuid not null,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  status text not null check (status in ('active', 'archived')),
  revision integer not null check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, group_id)
);
-- Archived names remain reserved so restoring cannot impersonate a newer group.
create unique index member_groups_name on haas.member_groups (tenant_id, lower(name));
create table haas.group_members (
  tenant_id text not null,
  group_id uuid not null,
  user_id uuid not null,
  primary key (tenant_id, group_id, user_id),
  foreign key (tenant_id, group_id) references haas.member_groups (tenant_id, group_id),
  foreign key (tenant_id, user_id) references haas.users (tenant_id, user_id)
);
create index group_members_user on haas.group_members (tenant_id, user_id);
