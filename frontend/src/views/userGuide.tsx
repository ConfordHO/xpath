import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import {
  Alert,
  Box,
  Button,
  Divider,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { LoadingPanel, PageHeader } from '../components'

const USER_GUIDE_PATH = '/OLYVIA_USER_GUIDE.md'

type GuideBlock =
  | {
      id: string
      level: number
      text: string
      type: 'heading'
    }
  | {
      text: string
      type: 'paragraph'
    }
  | {
      items: string[]
      type: 'ordered-list' | 'unordered-list'
    }
  | {
      headers: string[]
      rows: string[][]
      type: 'table'
    }

function isHeading(line: string) {
  return /^#{1,6}\s+/.test(line.trim())
}

function isUnorderedListItem(line: string) {
  return /^-\s+/.test(line.trim())
}

function isOrderedListItem(line: string) {
  return /^\d+\.\s+/.test(line.trim())
}

function isTableSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
}

function isTableStart(lines: string[], index: number) {
  const current = lines[index]?.trim() ?? ''
  const next = lines[index + 1]?.trim() ?? ''
  return current.startsWith('|') && current.includes('|') && isTableSeparator(next)
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? ''
  return (
    isHeading(line) ||
    isUnorderedListItem(line) ||
    isOrderedListItem(line) ||
    isTableStart(lines, index)
  )
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function createUniqueId(text: string, counts: Map<string, number>) {
  const base = slugify(text) || 'section'
  const count = counts.get(base) ?? 0
  counts.set(base, count + 1)
  return count === 0 ? base : `${base}-${count + 1}`
}

function parseGuide(markdown: string): GuideBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: GuideBlock[] = []
  const headingCounts = new Map<string, number>()
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (isHeading(line)) {
      const match = trimmed.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        const text = match[2].trim()
        blocks.push({
          id: createUniqueId(text, headingCounts),
          level: match[1].length,
          text,
          type: 'heading',
        })
      }
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const headers = parseTableRow(lines[index])
      const rows: string[][] = []
      index += 2

      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(parseTableRow(lines[index]))
        index += 1
      }

      blocks.push({ headers, rows, type: 'table' })
      continue
    }

    if (isUnorderedListItem(line)) {
      const items: string[] = []
      while (index < lines.length && isUnorderedListItem(lines[index])) {
        items.push(lines[index].trim().replace(/^-\s+/, ''))
        index += 1
      }
      blocks.push({ items, type: 'unordered-list' })
      continue
    }

    if (isOrderedListItem(line)) {
      const items: string[] = []
      while (index < lines.length && isOrderedListItem(lines[index])) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({ items, type: 'ordered-list' })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push({ text: paragraphLines.join(' '), type: 'paragraph' })
  }

  return blocks
}

function renderInline(text: string) {
  const pieces: ReactNode[] = []
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      pieces.push(text.slice(cursor, match.index))
    }

    if (match[2] && match[3]) {
      const href = match[3]
      pieces.push(
        <Link
          key={`${href}-${match.index}`}
          href={href}
          rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
          target={href.startsWith('http') ? '_blank' : undefined}
        >
          {match[2]}
        </Link>,
      )
    } else {
      pieces.push(
        <Box
          component="code"
          key={`code-${match.index}`}
          sx={{
            px: 0.5,
            py: 0.2,
            borderRadius: 1,
            bgcolor: 'rgba(18, 42, 76, 0.08)',
            color: 'primary.dark',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '0.92em',
          }}
        >
          {match[4]}
        </Box>,
      )
    }

    cursor = match.index + match[0].length
  }

  if (cursor < text.length) {
    pieces.push(text.slice(cursor))
  }

  return pieces
}

function GuideTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <TableContainer
      sx={{
        my: 2.5,
        border: '1px solid rgba(18, 42, 76, 0.12)',
        borderRadius: 2,
      }}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            {headers.map((header) => (
              <TableCell
                key={header}
                sx={{
                  bgcolor: 'rgba(18, 42, 76, 0.05)',
                  color: 'text.secondary',
                  fontWeight: 700,
                }}
              >
                {renderInline(header)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={`${row.join('-')}-${rowIndex}`}>
              {headers.map((_header, cellIndex) => (
                <TableCell key={cellIndex} sx={{ verticalAlign: 'top' }}>
                  {renderInline(row[cellIndex] ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function GuideBlockView({ block }: { block: GuideBlock }) {
  if (block.type === 'heading') {
    const variant = block.level === 1 ? 'h4' : block.level === 2 ? 'h5' : 'h6'
    return (
      <Box id={block.id} sx={{ scrollMarginTop: 96 }}>
        {block.level > 1 ? <Divider sx={{ my: block.level === 2 ? 3.5 : 2.5 }} /> : null}
        <Typography
          component={`h${Math.min(block.level + 1, 6)}` as 'h2'}
          variant={variant}
          sx={{
            fontWeight: 800,
            lineHeight: 1.18,
            mb: block.level === 1 ? 2 : 1.25,
          }}
        >
          {renderInline(block.text)}
        </Typography>
      </Box>
    )
  }

  if (block.type === 'paragraph') {
    return (
      <Typography sx={{ mb: 1.6, color: 'text.secondary', lineHeight: 1.75 }}>
        {renderInline(block.text)}
      </Typography>
    )
  }

  if (block.type === 'ordered-list' || block.type === 'unordered-list') {
    return (
      <List
        component={block.type === 'ordered-list' ? 'ol' : 'ul'}
        sx={{
          listStyleType: block.type === 'ordered-list' ? 'decimal' : 'disc',
          mb: 1.8,
          pl: 3.2,
          '& .MuiListItem-root': {
            display: 'list-item',
            py: 0.2,
            pl: 0.5,
          },
        }}
      >
        {block.items.map((item, index) => (
          <ListItem key={`${item}-${index}`} disablePadding>
            <ListItemText
              primary={renderInline(item)}
              primaryTypographyProps={{ sx: { color: 'text.secondary', lineHeight: 1.65 } }}
            />
          </ListItem>
        ))}
      </List>
    )
  }

  if (block.type === 'table') {
    return <GuideTable headers={block.headers} rows={block.rows} />
  }

  return null
}

export function UserGuidePage() {
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetch(USER_GUIDE_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error('The user guide could not be loaded.')
        }
        return response.text()
      })
      .then((text) => {
        if (!cancelled) {
          setMarkdown(text)
          setError('')
        }
      })
      .catch((guideError: Error) => {
        if (!cancelled) {
          setError(guideError.message)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const blocks = useMemo(() => parseGuide(markdown), [markdown])
  const sections = blocks.filter(
    (block): block is Extract<GuideBlock, { type: 'heading' }> =>
      block.type === 'heading' && block.level === 2,
  )

  return (
    <Box>
      <PageHeader
        title="User Guide"
        description="A plain-language guide for every OLYVIA user role, including patients, clinicians, reception, courier, laboratory, reporting, finance, admin, and super-admin workflows."
        action={
          <Button
            component="a"
            href={USER_GUIDE_PATH}
            rel="noopener noreferrer"
            target="_blank"
            variant="outlined"
            startIcon={<OpenInNewRoundedIcon />}
          >
            Open Markdown
          </Button>
        }
      />

      {loading ? <LoadingPanel label="Loading user guide..." /> : null}
      {!loading && error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && !error ? (
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', lg: '280px minmax(0, 1fr)' },
            alignItems: 'start',
          }}
        >
          <Box
            component="nav"
            aria-label="User guide sections"
            sx={{
              position: { lg: 'sticky' },
              top: 24,
              p: 2,
              borderRadius: 2,
              border: '1px solid rgba(18, 42, 76, 0.12)',
              bgcolor: 'background.paper',
              maxHeight: { lg: 'calc(100vh - 48px)' },
              overflowY: 'auto',
            }}
          >
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.1em' }}>
              Sections
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {sections.map((section) => (
                <Link
                  key={section.id}
                  href={`#${section.id}`}
                  underline="hover"
                  sx={{
                    color: 'text.primary',
                    fontSize: 14,
                    lineHeight: 1.35,
                  }}
                >
                  {section.text}
                </Link>
              ))}
            </Stack>
          </Box>

          <Box
            sx={{
              minWidth: 0,
              p: { xs: 2.25, md: 4 },
              borderRadius: 2,
              border: '1px solid rgba(18, 42, 76, 0.12)',
              bgcolor: 'background.paper',
              boxShadow: '0 18px 45px rgba(22, 36, 61, 0.06)',
              '& h2, & h3, & h4, & h5, & h6': {
                color: 'text.primary',
              },
            }}
          >
            {blocks.map((block, index) => (
              <GuideBlockView key={`${block.type}-${index}`} block={block} />
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
