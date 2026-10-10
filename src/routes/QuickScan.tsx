import { PageHeader } from '../ui'

/** Placeholder until the quick-scan screen is written; the route #/scan already resolves to this file. */
export default function QuickScan() {
  return <PageHeader title="Quick scan" back={{ to: '/scans', label: 'All scans' }} />
}
