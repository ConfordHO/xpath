# Seeded Credentials

The application now ensures canonical demo users exist for each core role, including site-scoped admins and a global super admin.

These credentials are for local/demo validation only. Before any live public deployment, create production users through the authenticated admin console, rotate or disable all seeded accounts, enable MFA for admin roles, and keep `PUBLIC_REGISTRATION_ENABLED=false`.

All passwords:

`admin123`

## Primary role logins

| Role | Email | Site scope |
| --- | --- | --- |
| Super admin | `superadmin@xpath.lims` | Global |
| Admin | `admin@xpath.lims` | `site-1` XPath Central Lab |
| Admin (other lab) | `admin.nairobi@xpath.lims` | `site-2` Nairobi Collection Center |
| Receptionist | `receptionist@xpath.lims` | `site-1` XPath Central Lab |
| Technician | `technician@xpath.lims` | `site-1` XPath Central Lab |
| Pathologist | `pathologist@xpath.lims` | `site-1` XPath Central Lab |
| Finance | `finance@xpath.lims` | `site-1` XPath Central Lab |
| Courier | `courier@xpath.lims` | `site-1` XPath Central Lab |
| Doctor / Referrer portal | `doctor@xpath.lims` | `site-1` XPath Central Lab |

## Notes

- `superadmin@xpath.lims` can see and manage every site, including creating, activating, deactivating, and deleting users.
- `admin@xpath.lims` is a single-site lab manager and is restricted to their own site’s operational users and data.
- Site admins can activate, deactivate, edit, and delete their own site’s operational users, but they cannot manage admins or super admins.
- `admin.nairobi@xpath.lims` is useful for confirming that one admin cannot see or manage users from the other lab.
- The patient portal uses lookup rather than a seeded login account.
- The removed legacy demo accounts are no longer part of the canonical seed set.
- Every authenticated role can open `/project-review` from the Account navigation to submit project review comments for developers. Admins can triage comments for their own site, while super admins can triage all comments.
