import { useRoute } from '../router'
import { LinkButton, PageHeader } from '../ui'

export default function NotFound() {
  const { path } = useRoute()
  return (
    <div className="u-stack u-stack--lg">
      <PageHeader title="Page not found" subtitle={`There is no page at ${path}.`} />
      <div>
        <LinkButton to="/" variant="primary" icon="home">
          Go to Home
        </LinkButton>
      </div>
    </div>
  )
}
