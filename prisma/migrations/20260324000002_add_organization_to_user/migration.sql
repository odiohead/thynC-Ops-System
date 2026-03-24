ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
