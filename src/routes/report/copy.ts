/**
 * Every fixed sentence the scan history and the report print. Kept in one place so tests/unit/report-tone.test.ts can
 * run the tone linter (docs/PLAN.md section 2, rule 6) over all of it. Numbers and names are filled in by helpers.ts.
 */

export const COPY = {
  historyTitle: 'Scan history',
  historySubtitle: 'Every scan stored on this device, newest first.',
  historyEmptyTitle: 'No scans stored',
  historyEmptyText: 'Nothing has been measured yet. A quick scan takes one front photo and measures what a front photo can show.',
  historyEmptyAction: 'Start a quick scan',
  historyNewScan: 'New scan',
  historyLoadError: 'The scan history could not be read from this device.',
  historyDeleteTitle: 'Delete this scan?',
  deleteConfirm: 'Delete scan',

  reportTitle: 'Scan report',
  reportBack: 'All scans',
  reportNotFoundTitle: 'Scan not found',
  reportNotFoundText: 'This scan does not exist on this device. It may have been deleted.',
  reportLoadError: 'This scan could not be read from this device.',
  reportLoadHelp: 'Its stored data is damaged or incomplete. It can still be deleted from the scan history.',

  overallNotAvailable: 'Overall score: not available',
  overallNotAvailableWhy: 'No number is shown: a number built from this little of the model would be made up.',
  overallThresholdLabel: '50% needed for an overall score',
  overallNothingScored: 'No metric in this scan could be scored. The re-capture list below says what to change.',
  overallProvisionalNote: 'Provisional: less than 75% of the total weight was scored, so the number can move a lot when more is measured.',
  overallBuildScope:
    'This build measures only frontal-photo metrics. Profile, body, skin and hair metrics are not measured yet, so most of the model has no input.',
  overallWeightsNote: 'Every metric below shows its weight and the points it costs.',
  caiProvisional: 'provisional – ceilings are not personalised yet',
  caiUnavailable: 'not available – too little of the changeable weight was scored in this scan (at least 50% is needed)',

  recaptureTitle: 'What to re-capture',
  recaptureIntro: 'These metrics were refused because the photo could not support a number. Fix these, then scan again.',
  recaptureFailedChecks: 'Failed photo checks',
  recaptureSteps: 'To re-capture',
  recaptureIgnored: 'also refused, but they carry no weight, so a re-capture for them alone changes nothing.',

  dragTitle: 'Points lost',
  dragIntro: 'Points lost are out of the 100 total weight. Only metrics scored with HIGH or MEDIUM confidence are counted.',
  dragTopTitle: 'Biggest drags',
  dragNone: 'No points were lost on the scored metrics.',
  dragJump: 'Show card',

  metricsTitle: 'Metrics',
  metricsIntro: 'Each reason below is the exact text stored with the score. Nothing here is recomputed.',
  metricsNone: 'This scan holds no metric records.',
  reasonLabel: 'Reason stored with the score',
  storedRecordLabel: 'Stored record',
  moreOnMetric: 'Metric details',

  lowWarningTitle: 'LOW confidence',
  lowWarning: 'This number is shown for reference only. It is left out of the overall score.',
  notScored: 'Not scored',
  notCounted: 'Not counted',
  refusedWhy: 'Why it was refused',
  refusedFix: 'Re-capture',
  baselineBadge: 'Baseline set',
  baselineNote: 'This scan sets your baseline; it is scored from your next scan.',
  unscoredBadge: 'Not scored',
  integrityNote:
    'A score was stored here without its reason or facts. The number is hidden: no score is shown without the reason behind it.',
  noScoreRecord: 'No score record was saved for this measurement.',

  photosTitle: 'Photos',
  photosNone: 'No photos were stored with this scan.',
  photosNote: 'Stored as re-encoded JPEG with no metadata. The camera image is not mirrored.',

  deleteTitle: 'Delete this scan',
  deleteText: 'Removes this scan, its photos, measurements and scores from this device. This cannot be undone.',
  deleteButton: 'Delete this scan',
  deleteBody:
    'This scan, its photos, measurements and scores are removed from this device. This cannot be undone. A personal baseline this scan set stays, so later scans can still be scored against it.',

  footerTitle: 'About these numbers',
  footerWeights: 'The weights are judgement, not a validated model.',
  footerWhy:
    'No study turns these metrics into one attractiveness number. The weights are evidence-informed, shown openly and version-numbered. Face ratios from one photo are estimates with an error that each card states.',
  footerLink: 'How scoring works',
} as const

export type CopyKey = keyof typeof COPY
