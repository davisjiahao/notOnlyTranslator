import LearningDashboard from './LearningDashboard';

export default function LearningStatistics({ isSaving }: { isSaving: boolean }) {
  return <LearningDashboard isSaving={isSaving} mode="statistics" />;
}
