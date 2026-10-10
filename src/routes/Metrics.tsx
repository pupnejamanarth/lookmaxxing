import { useRoute } from '../router'
import MetricDetail from './MetricDetail'
import MetricList from './catalog/MetricList'

/** #/metrics is the browser, #/metrics/:id is one metric. */
export default function Metrics() {
  const { segments } = useRoute()
  const id = segments[1]
  return id ? <MetricDetail id={id} /> : <MetricList />
}
