import './settings/settings.css'
import { PageHeader } from '../ui'
import ActivityLog from './settings/ActivityLog'
import AppInfo from './settings/AppInfo'
import BackupCard from './settings/BackupCard'
import DangerZone from './settings/DangerZone'
import PrivacyCheck from './settings/PrivacyCheck'
import RestoreCard from './settings/RestoreCard'
import StorageCard from './settings/StorageCard'

export default function Settings() {
  return (
    <div className="u-stack u-stack--lg st">
      <PageHeader title="Settings" subtitle="Privacy, backup and storage. Everything here runs on this device." />
      <PrivacyCheck />
      <BackupCard />
      <RestoreCard />
      <StorageCard />
      <ActivityLog />
      <AppInfo />
      <DangerZone />
    </div>
  )
}
