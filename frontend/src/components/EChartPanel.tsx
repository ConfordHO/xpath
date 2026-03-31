import { Box } from '@mui/material'
import type { EChartsOption } from 'echarts'
import ReactECharts from 'echarts-for-react'
import type { ReactNode } from 'react'

import { SectionCard } from './SectionCard'

interface EChartPanelProps {
  title: string
  description?: string
  option: EChartsOption
  action?: ReactNode
  height?: number
}

export function EChartPanel({
  title,
  description,
  option,
  action,
  height = 320,
}: EChartPanelProps) {
  return (
    <SectionCard title={title} description={description} action={action}>
      <Box sx={{ minWidth: 0, height }}>
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
      </Box>
    </SectionCard>
  )
}
