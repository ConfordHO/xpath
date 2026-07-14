import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'

import { api } from '../api'
import { OcrOrderUpload } from '../components/OcrOrderUpload'

import { useAuth } from '../auth'
import { translateTextForLocale, useLanguage } from '../i18n'
import {
  allowedUserRolesForManager,
  canManageListedUser,
  canDeleteUsers,
  canSelectUserSite,
  defaultSiteIdForUser,
  roleLabels,
} from '../app/access'

import {
  EmptyState,
  LoadingPanel,
  MetricCard,
  PageHeader,
  SectionCard,
} from '../components'

import { errorMessage, unwrapList, useLoadable } from './shared'

import type {
  Doctor,
  SafeUser,
  Settings,
  Site,
  TestType,
  UserRole,
  WorkflowTemplate,
} from '../types'

import { formatInsurancePrice, formatTestPrice } from '../utils'

export function UsersPage() {
  const { user } = useAuth()
  const { locale } = useLanguage()
  const usersState = useLoadable<SafeUser[]>([], [], async () => {
    const response = await api.get<SafeUser[] | { data: SafeUser[] }>('/users')
    return unwrapList(response.data)
  })
  const sitesState = useLoadable<Site[]>([], [], async () => {
    const response = await api.get<Site[]>('/sites')
    return response.data
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SafeUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<{
    name: string
    email: string
    role: UserRole
    active: boolean
    password: string
    siteId: string
    preferredLocale: 'en' | 'fr'
  }>({
    name: '',
    email: '',
    role: 'receptionist',
    active: true,
    password: 'ChangeMe123!',
    siteId: defaultSiteIdForUser(user),
    preferredLocale: user?.preferredLocale ?? 'fr',
  })

  const siteName = (siteId?: string | null) =>
    sitesState.data.find((site) => site._id === siteId)?.name ?? siteId ?? 'Global'

  const resetForm = () =>
    setForm({
      name: '',
      email: '',
      role: 'receptionist',
      active: true,
      password: 'ChangeMe123!',
      siteId: defaultSiteIdForUser(user),
      preferredLocale: user?.preferredLocale ?? 'fr',
    })

  const openCreate = () => {
    setEditing(null)
    setError(null)
    setMessage(null)
    resetForm()
    setDialogOpen(true)
  }

  const openEdit = (user: SafeUser) => {
    setError(null)
    setMessage(null)
    setEditing(user)
    setForm({
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      password: '',
      siteId: user.siteId ?? '',
      preferredLocale: user.preferredLocale ?? 'fr',
    })
    setDialogOpen(true)
  }

  const save = async () => {
    setError(null)
    const payload = {
      ...form,
      siteId:
        form.role === 'super_admin'
          ? null
          : canSelectUserSite(user)
            ? form.siteId || defaultSiteIdForUser(user)
            : defaultSiteIdForUser(user),
      preferredLocale: form.preferredLocale,
      preferredLanguage: form.preferredLocale === 'fr' ? 'french' : 'english',
    }
    if (editing && !form.password.trim()) {
      delete (payload as Partial<typeof payload>).password
    }
    try {
      if (editing) {
        await api.put(`/users/${editing._id}`, payload)
      } else {
        await api.post('/users', payload)
      }
      setDialogOpen(false)
      setMessage(editing ? 'User updated successfully.' : 'User created successfully.')
      usersState.refresh()
    } catch (saveError) {
      setError(errorMessage(saveError))
    }
  }

  const toggleActive = async (target: SafeUser) => {
    if (
      !window.confirm(
        translateTextForLocale(
          `${target.active ? 'Deactivate' : 'Activate'} ${target.email}?`,
          locale,
        ),
      )
    ) {
      return
    }
    try {
      await api.put(`/users/${target._id}`, { active: !target.active })
      setMessage(`${target.email} ${target.active ? 'deactivated' : 'activated'}.`)
      usersState.setData((current) =>
        current.map((entry) =>
          entry._id === target._id
            ? { ...entry, active: !target.active }
            : entry,
        ),
      )
      usersState.refresh()
    } catch (toggleError) {
      setError(errorMessage(toggleError))
    }
  }

  const deleteUser = async (target: SafeUser) => {
    if (
      !window.confirm(
        translateTextForLocale(`Delete ${target.email}? This cannot be undone.`, locale),
      )
    ) {
      return
    }
    try {
      await api.delete(`/users/${target._id}`)
      setMessage(`${target.email} deleted.`)
      usersState.setData((current) => current.filter((entry) => entry._id !== target._id))
      usersState.refresh()
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    }
  }

  const roleOptions = allowedUserRolesForManager(user)

  return (
    <Stack spacing={3}>
      <PageHeader
        title="User management"
        description="Super admin manages the whole network. Admin is restricted to their own lab and operational staff."
        action={<Button variant="contained" onClick={openCreate}>Create user</Button>}
      />
      {message ? <Alert severity="success">{message}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <SectionCard>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Site</TableCell>
                <TableCell>Active</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {usersState.data.map((account) => (
                <TableRow key={account._id}>
                  <TableCell>{account.name}</TableCell>
                  <TableCell>{account.email}</TableCell>
                  <TableCell>{roleLabels[account.role]}</TableCell>
                  <TableCell>{siteName(account.siteId)}</TableCell>
                  <TableCell>{account.active ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                      <Button
                        disabled={!canManageListedUser(user, account)}
                        onClick={() => openEdit(account)}
                      >
                        Edit
                      </Button>
                      <Button
                        disabled={!canManageListedUser(user, account)}
                        onClick={() => toggleActive(account)}
                      >
                        {account.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      {canDeleteUsers(user) && canManageListedUser(user, account) ? (
                        <Button color="error" onClick={() => deleteUser(account)}>
                          Delete
                        </Button>
                      ) : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit user' : 'Create new user'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField label="Name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            <TextField label="Email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
            <FormControl>
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
                value={form.role}
                onChange={(event) => setForm((prev) => ({ ...prev, role: String(event.target.value) as UserRole }))}
              >
                {roleOptions.map((role) => (
                  <MenuItem key={role} value={role}>{roleLabels[role]}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Site</InputLabel>
              <Select
                label="Site"
                value={form.role === 'super_admin' ? '' : form.siteId}
                disabled={!canSelectUserSite(user) || form.role === 'super_admin'}
                onChange={(event) => setForm((prev) => ({ ...prev, siteId: String(event.target.value) }))}
              >
                {sitesState.data.map((site) => (
                  <MenuItem key={site._id} value={site._id}>{site.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Preferred language</InputLabel>
              <Select
                label="Preferred language"
                value={form.preferredLocale}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    preferredLocale: String(event.target.value) as 'en' | 'fr',
                  }))
                }
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="fr">Francais</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={editing ? 'New password' : 'Temporary password'}
              value={form.password}
              helperText={editing ? 'Leave blank to keep the current password.' : 'Use at least 10 characters with upper, lower, number, and symbol.'}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
            <FormControlLabel control={<Checkbox checked={form.active} onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))} />} label="Active" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function DoctorsPage() {
  const doctorsState = useLoadable<Doctor[]>([], [], async () => {
    const response = await api.get<Doctor[]>('/doctors')
    return response.data
  })
  const usersState = useLoadable<SafeUser[]>([], [], async () => {
    const response = await api.get<SafeUser[] | { data: SafeUser[] }>('/users')
    return unwrapList(response.data)
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Doctor | null>(null)
  const [form, setForm] = useState({ name: '', code: '', type: 'doctor', email: '', phone: '', active: true, userId: '' })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const payload = { ...form, userId: form.userId || null }
    setMessage(null)
    setError(null)
    try {
      const response = editing
        ? await api.put<{ doctor: Doctor; generatedPassword: string | null }>(`/doctors/${editing._id}`, payload)
        : await api.post<{ doctor: Doctor; generatedPassword: string | null }>('/doctors', payload)
      const generatedPassword = response.data.generatedPassword
      setMessage(
        generatedPassword
          ? `Doctor saved. Temporary portal password: ${generatedPassword}`
          : 'Doctor saved successfully.',
      )
      setDialogOpen(false)
      doctorsState.refresh()
    } catch (saveError) {
      setError(errorMessage(saveError))
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Doctors & Referrers" action={<Button variant="contained" onClick={() => { setEditing(null); setDialogOpen(true) }}>Add doctor / clinic</Button>} />
      {message ? <Alert severity="success">{message}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <SectionCard description="Create doctors or clinics for referral tracking. Link a portal user so they can sign in and view their referral statistics here.">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Contact</TableCell>
                <TableCell>Portal user</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {doctorsState.data.map((doctor) => (
                <TableRow key={doctor._id}>
                  <TableCell>{doctor.name}</TableCell>
                  <TableCell>{doctor.code}</TableCell>
                  <TableCell>{doctor.type}</TableCell>
                  <TableCell>{doctor.email}</TableCell>
                  <TableCell>{doctor.user?.email ?? '—'}</TableCell>
                  <TableCell>
                    <Button onClick={() => { setEditing(doctor); setForm({ name: doctor.name, code: doctor.code, type: doctor.type, email: doctor.email, phone: doctor.phone, active: doctor.active, userId: doctor.user?._id ?? '' }); setDialogOpen(true) }}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit doctor / clinic' : 'Add doctor / clinic'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField label="Name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            <TextField label="Code" value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} />
            <FormControl>
              <InputLabel>Type</InputLabel>
              <Select label="Type" value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: String(event.target.value) }))}>
                <MenuItem value="doctor">doctor</MenuItem>
                <MenuItem value="clinic">clinic</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
            <TextField label="Phone" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
            <FormControl>
              <InputLabel>Portal user</InputLabel>
              <Select label="Portal user" value={form.userId} onChange={(event) => setForm((prev) => ({ ...prev, userId: String(event.target.value) }))}>
                <MenuItem value="">None</MenuItem>
                {usersState.data.filter((user) => user.role === 'doctor').map((user) => (
                  <MenuItem key={user._id} value={user._id}>{user.email}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel control={<Checkbox checked={form.active} onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))} />} label="Active" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function TestTypesPage() {
  const emptyTestTypeForm = {
    code: '',
    name: '',
    description: '',
    category: 'Histology',
    sampleType: '',
    price: 0,
    insurancePrice: '',
    priceNote: '',
    active: true,
  }
  const testsState = useLoadable<TestType[]>([], [], async () => {
    const response = await api.get<TestType[]>('/test-types')
    return response.data
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TestType | null>(null)
  const [form, setForm] = useState(emptyTestTypeForm)

  const save = async () => {
    const payload = {
      ...form,
      price: Number(form.price),
      insurancePrice: form.insurancePrice === '' ? undefined : Number(form.insurancePrice),
      priceNote: form.priceNote.trim() || undefined,
      sampleType: form.sampleType.trim() || undefined,
    }
    if (editing) {
      await api.put(`/test-types/${editing._id}`, payload)
    } else {
      await api.post('/test-types', payload)
    }
    setDialogOpen(false)
    testsState.refresh()
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Test types" action={<Button variant="contained" onClick={() => { setEditing(null); setForm(emptyTestTypeForm); setDialogOpen(true) }}>Create test type</Button>} />
      <SectionCard description="Patient prices are stored in FCFA and shown with USD, EUR, and legacy French franc equivalents. Only active test types appear on public order screens.">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Sample</TableCell>
                <TableCell>Patient price</TableCell>
                <TableCell>Insurer price</TableCell>
                <TableCell>Active</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {testsState.data.map((test) => (
                <TableRow key={test._id}>
                  <TableCell>{test.code}</TableCell>
                  <TableCell>{test.name}</TableCell>
                  <TableCell>{test.category}</TableCell>
                  <TableCell>{test.sampleType ?? '—'}</TableCell>
                  <TableCell>{formatTestPrice(test)}</TableCell>
                  <TableCell>{formatInsurancePrice(test)}</TableCell>
                  <TableCell>{test.active ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    <Button onClick={() => {
                      setEditing(test)
                      setForm({
                        code: test.code,
                        name: test.name,
                        description: test.description ?? '',
                        category: test.category,
                        sampleType: test.sampleType ?? '',
                        price: test.price,
                        insurancePrice: typeof test.insurancePrice === 'number' ? String(test.insurancePrice) : '',
                        priceNote: test.priceNote ?? '',
                        active: test.active,
                      })
                      setDialogOpen(true)
                    }}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit test type' : 'Create test type'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Code" value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} />
            <TextField label="Name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            <TextField label="Description" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            <TextField label="Category" value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} />
            <TextField label="Sample type" value={form.sampleType} onChange={(event) => setForm((prev) => ({ ...prev, sampleType: event.target.value }))} />
            <TextField label="Patient price (FCFA)" type="number" value={form.price} onChange={(event) => setForm((prev) => ({ ...prev, price: Number(event.target.value) }))} />
            <TextField label="Insurer price (FCFA)" type="number" value={form.insurancePrice} onChange={(event) => setForm((prev) => ({ ...prev, insurancePrice: event.target.value }))} />
            <TextField label="Price note" value={form.priceNote} onChange={(event) => setForm((prev) => ({ ...prev, priceNote: event.target.value }))} />
            <FormControlLabel control={<Checkbox checked={form.active} onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))} />} label="Active" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function WorkflowTemplatesPage() {
  const templatesState = useLoadable<WorkflowTemplate[]>([], [], async () => {
    const response = await api.get<WorkflowTemplate[]>('/workflows/templates')
    return response.data
  })
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null)
  const [name, setName] = useState('')
  const [steps, setSteps] = useState('')

  return (
    <Stack spacing={3}>
      <PageHeader title="Workflow templates" description="Lab processing workflows" />
      <Stack spacing={2}>
        {templatesState.data.map((template) => (
          <Paper key={template.id} sx={{ p: 3 }}>
            <Typography variant="h5">{template.name}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{template.steps.join(' → ')}</Typography>
            <Button sx={{ mt: 2 }} onClick={() => { setEditing(template); setName(template.name); setSteps(template.steps.join(', ')) }}>
              Edit template
            </Button>
          </Paper>
        ))}
      </Stack>
      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit workflow template</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
            <TextField label="Steps (comma separated)" value={steps} onChange={(event) => setSteps(event.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!editing) return
              await api.put(`/workflows/templates/${editing.id}`, {
                name,
                steps: steps.split(',').map((item) => item.trim()).filter(Boolean),
              })
              setEditing(null)
              templatesState.refresh()
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function SystemSettingsPage() {
  const { setLocale } = useLanguage()
  const settingsState = useLoadable<Settings | null>(null, [], async () => {
    const response = await api.get<Settings>('/settings')
    return response.data
  })
  const testsState = useLoadable<TestType[]>([], [], async () => {
    const response = await api.get<TestType[]>('/test-types')
    return response.data
  })
  const [form, setForm] = useState<Settings | null>(null)

  useEffect(() => {
    if (settingsState.data) {
      setForm(settingsState.data)
    }
  }, [settingsState.data])

  if (settingsState.loading || !form) return <LoadingPanel label="Loading settings…" />

  return (
    <Stack spacing={3}>
      <PageHeader title="System settings" description="System-wide configuration: language, lab name, timezone, and test types." />
      <SectionCard title="Language">
        <Stack spacing={2}>
          <FormControl>
            <InputLabel>Language</InputLabel>
            <Select label="Language" value={form.language} onChange={(event) => setForm((prev) => (prev ? { ...prev, language: String(event.target.value) as Settings['language'], locale: String(event.target.value) === 'french' ? 'fr' : 'en' } : prev))}>
              <MenuItem value="english">English</MenuItem>
              <MenuItem value="french">French</MenuItem>
            </Select>
          </FormControl>
          <Typography color="text.secondary">App language (sidebar, headers, this page). Stored in your browser.</Typography>
        </Stack>
      </SectionCard>
      <SectionCard title="Public lab information (landing page & contact)">
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
          <TextField label="Lab name" value={form.labName} onChange={(event) => setForm((prev) => (prev ? { ...prev, labName: event.target.value } : prev))} />
          <TextField label="Tagline (hero)" value={form.tagline} onChange={(event) => setForm((prev) => (prev ? { ...prev, tagline: event.target.value } : prev))} />
          <TextField label="Contact email" value={form.contactEmail} onChange={(event) => setForm((prev) => (prev ? { ...prev, contactEmail: event.target.value } : prev))} />
          <TextField label="Contact phone" value={form.contactPhone} onChange={(event) => setForm((prev) => (prev ? { ...prev, contactPhone: event.target.value } : prev))} />
          <TextField label="Address" value={form.address} onChange={(event) => setForm((prev) => (prev ? { ...prev, address: event.target.value } : prev))} />
          <TextField label="Business hours" value={form.businessHours} onChange={(event) => setForm((prev) => (prev ? { ...prev, businessHours: event.target.value } : prev))} />
          <TextField label="Timezone" value={form.timezone} onChange={(event) => setForm((prev) => (prev ? { ...prev, timezone: event.target.value } : prev))} />
          <FormControl>
            <InputLabel>Currency</InputLabel>
            <Select label="Currency" value={form.currency} onChange={(event) => setForm((prev) => (prev ? { ...prev, currency: String(event.target.value) as Settings['currency'] } : prev))}>
              <MenuItem value="USD">USD</MenuItem>
              <MenuItem value="EUR">EUR</MenuItem>
              <MenuItem value="XAF">XAF</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <TextField sx={{ mt: 2 }} label="About text" multiline minRows={4} fullWidth value={form.aboutText} onChange={(event) => setForm((prev) => (prev ? { ...prev, aboutText: event.target.value } : prev))} />
        <TextField sx={{ mt: 2 }} label="Accreditations (comma-separated)" fullWidth value={form.accreditations.join(', ')} onChange={(event) => setForm((prev) => (prev ? { ...prev, accreditations: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } : prev))} />
        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            onClick={async () => {
              if (!form) return
              await api.put('/settings', form)
              setLocale(form.locale, { persistPreference: false })
              settingsState.refresh()
            }}
          >
            Save changes
          </Button>
        </Stack>
      </SectionCard>
      <SectionCard title="Test types">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Patient price</TableCell>
                <TableCell>Insurer price</TableCell>
                <TableCell>Category</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {testsState.data.map((test) => (
                <TableRow key={test._id}>
                  <TableCell>{test.code}</TableCell>
                  <TableCell>{test.name}</TableCell>
                  <TableCell>{formatTestPrice(test)}</TableCell>
                  <TableCell>{formatInsurancePrice(test)}</TableCell>
                  <TableCell>{test.category}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Stack>
  )
}

export function MyAccountPage() {
  const { user, refreshUser } = useAuth()
  const { setLocale } = useLanguage()
  const [name, setName] = useState(user?.name ?? '')
  const [preferredLocale, setPreferredLocale] = useState<'en' | 'fr'>(user?.preferredLocale ?? 'fr')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(user?.name ?? '')
    setPreferredLocale(user?.preferredLocale ?? 'fr')
  }, [user])

  const saveProfile = async () => {
    setError(null)
    setMessage(null)
    try {
      await api.put('/users/me', {
        name,
        preferredLocale,
        preferredLanguage: preferredLocale === 'fr' ? 'french' : 'english',
      })
      setLocale(preferredLocale, { persistPreference: false })
      await refreshUser()
      setMessage('Profile updated.')
    } catch (saveError) {
      setError(errorMessage(saveError))
    }
  }

  const savePassword = async () => {
    setError(null)
    setMessage(null)
    try {
      await api.put('/users/me/password', {
        currentPassword,
        newPassword,
        confirmPassword,
      })
      setMessage('Password updated.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (saveError) {
      setError(errorMessage(saveError))
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="My account" description="Update your name and password. Changes apply to all portals for your user." />
      <SectionCard>
        <Stack spacing={2}>
          {message ? <Alert severity="success">{message}</Alert> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <TextField label="Email" value={user?.email ?? ''} disabled />
          <TextField label="Role" value={user?.role ?? ''} disabled />
          <FormControl>
            <InputLabel>Preferred language</InputLabel>
            <Select
              label="Preferred language"
              value={preferredLocale}
              onChange={(event) =>
                setPreferredLocale(String(event.target.value) as 'en' | 'fr')
              }
            >
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="fr">Francais</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained" onClick={saveProfile}>
            Save changes
          </Button>
          <Divider />
          <TextField label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          <TextField label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          <TextField label="Confirm new password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <Button variant="outlined" onClick={savePassword}>
            Save password
          </Button>
        </Stack>
      </SectionCard>
    </Stack>
  )
}

export function DoctorPortalPage() {
  const profileState = useLoadable<any>(null, [], async () => {
    const [profileResponse, statsResponse, ordersResponse, servicesResponse] = await Promise.all([
      api.get('/doctors/me/profile'),
      api.get('/doctors/me/stats'),
      api.get('/doctors/me/orders'),
      api.get('/public/services'),
    ])
    return {
      profile: profileResponse.data,
      stats: statsResponse.data,
      orders: ordersResponse.data.data,
      services: servicesResponse.data,
    }
  })
  const [patient, setPatient] = useState({ firstName: '', lastName: '', dateOfBirth: '', phone: '', email: '' })
  const [testTypeIds, setTestTypeIds] = useState<string[]>([])
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMessage, setCreateMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const createReferralOrder = async () => {
    setCreateMessage(null)
    setCreating(true)
    try {
      const response = await api.post('/doctors/me/orders', {
        patient,
        testCodes: testTypeIds,
        clinicalHistory: clinicalNotes,
      })
      setCreateMessage({ kind: 'success', text: `Order ${response.data.orderNumber} created.` })
      setPatient({ firstName: '', lastName: '', dateOfBirth: '', phone: '', email: '' })
      setTestTypeIds([])
      setClinicalNotes('')
      profileState.refresh()
    } catch (error) {
      setCreateMessage({ kind: 'error', text: errorMessage(error) })
    } finally {
      setCreating(false)
    }
  }

  if (profileState.loading) return <LoadingPanel label="Loading referrer portal…" />
  if (profileState.error || !profileState.data) {
    return (
      <EmptyState
        title="Referrer portal"
        body="Your user account is not linked to a doctor/clinic record yet. Ask an administrator to create your referrer profile and link it to your account so you can see referral statistics here."
      />
    )
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Referrer portal" />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
        <MetricCard label="Total referrals" value={String(profileState.data.stats.totalOrders)} />
        <MetricCard label="Completed" value={String(profileState.data.stats.completedOrders)} />
        <MetricCard label="In review" value={String(profileState.data.stats.reviewOrders)} />
      </Box>
      <SectionCard title="Profile">
        <Typography>{profileState.data.profile.name}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>{profileState.data.profile.email}</Typography>
      </SectionCard>
      <SectionCard title="Create referral order">
        <Stack spacing={2}>
          {createMessage ? <Alert severity={createMessage.kind}>{createMessage.text}</Alert> : null}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
            <TextField label="Patient first name" value={patient.firstName} onChange={(event) => setPatient((prev) => ({ ...prev, firstName: event.target.value }))} />
            <TextField label="Patient last name" value={patient.lastName} onChange={(event) => setPatient((prev) => ({ ...prev, lastName: event.target.value }))} />
            <TextField label="Date of birth" type="date" InputLabelProps={{ shrink: true }} value={patient.dateOfBirth} onChange={(event) => setPatient((prev) => ({ ...prev, dateOfBirth: event.target.value }))} />
            <TextField label="Phone" value={patient.phone} onChange={(event) => setPatient((prev) => ({ ...prev, phone: event.target.value }))} />
            <TextField label="Email" value={patient.email} onChange={(event) => setPatient((prev) => ({ ...prev, email: event.target.value }))} />
          </Box>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
            {profileState.data.services.map((test: TestType) => (
              <Paper key={test._id} sx={{ p: 2 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={testTypeIds.includes(test._id)}
                      onChange={(event) => {
                        setTestTypeIds((prev) =>
                          event.target.checked ? [...prev, test._id] : prev.filter((item) => item !== test._id),
                        )
                      }}
                    />
                  }
                  label={`${test.code} — ${test.name}`}
                />
              </Paper>
            ))}
          </Box>
          <TextField label="Clinical notes" multiline minRows={3} value={clinicalNotes} onChange={(event) => setClinicalNotes(event.target.value)} />
          <OcrOrderUpload
            title="Scan referral requisition"
            buildCorrections={() => ({
              source: 'clinician_portal',
              patient,
              testCodes: testTypeIds,
              clinicianId: profileState.data.profile._id,
              clinicalNotes,
            })}
            onOrderCreated={() => profileState.refresh()}
          />
          <Button variant="contained" disabled={creating || !testTypeIds.length} onClick={createReferralOrder}>
            Create referral order
          </Button>
        </Stack>
      </SectionCard>
      <SectionCard title="Referral cases">
        {profileState.data.orders.length ? (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Order #</TableCell>
                  <TableCell>Patient</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profileState.data.orders.slice(0, 10).map((order: any) => (
                  <TableRow key={order._id}>
                    <TableCell>{order.orderNumber}</TableCell>
                    <TableCell>{order.patient.firstName} {order.patient.lastName}</TableCell>
                    <TableCell>{order.status}</TableCell>
                    <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button component={RouterLink} to={`/orders/${order._id}`}>
                        Open case
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState title="No linked referral cases." body="Once orders are linked to your clinician profile, they will appear here." />
        )}
      </SectionCard>
    </Stack>
  )
}
