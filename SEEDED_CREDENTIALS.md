# Seeded Credentials

The application seeds only the current OLYVIA super admin account. The old demo-domain accounts have been retired and should not be recreated.

These credentials are for local/demo validation only. Before any live public deployment, create production users through the authenticated admin console, rotate or disable seeded accounts as required, enable MFA for admin roles when ready, and keep `PUBLIC_REGISTRATION_ENABLED=false`.

Default password:

`admin123`

## Primary Seeded Login

| Role | Email | Site scope |
| --- | --- | --- |
| Super admin | `kiy@xpath-labs.com` | Global |

## Notes

- `kiy@xpath-labs.com` is seeded as a global super admin. It uses `admin123` unless `KIY_SUPER_ADMIN_PASSWORD` is set before a fresh database is initialized.
- Site admins can activate, deactivate, edit, and delete their own site’s operational users, but they cannot manage admins or super admins.
- The patient portal uses lookup rather than a seeded login account.
- The removed legacy demo accounts are no longer part of the canonical seed set and are purged when older seed snapshots are cleaned.
- Every authenticated role can open `/project-review` from the Account navigation to submit project review comments for developers. Admins can triage comments for their own site, while super admins can triage all comments.
