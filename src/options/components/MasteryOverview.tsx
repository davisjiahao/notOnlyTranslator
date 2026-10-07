import LearningDashboard from './LearningDashboard';

export default function MasteryOverview({ isSaving }: { isSaving: boolean }) {
  return <LearningDashboard isSaving={isSaving} mode="mastery" />;
}
