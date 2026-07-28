import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { TrendMonthPoint } from '../utils/taskTrend';

type DotRenderProps = {
  cx?: number;
  cy?: number;
  stroke?: string;
  payload?: TrendMonthPoint;
  dataKey?: string | number;
};

function ClickableDot({
  cx,
  cy,
  stroke,
  payload,
  dataKey,
  urlKey,
}: DotRenderProps & { urlKey: 'incidentListUrl' | 'changeListUrl' }) {
  if (cx == null || cy == null || !payload || dataKey == null) return null;

  const key = String(dataKey) as 'incidents' | 'changes';
  const count = payload[key] ?? 0;
  const url = payload[urlKey];
  if (count <= 0 || !url) return null;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={stroke}
      stroke="#fff"
      strokeWidth={2}
      style={{ cursor: 'pointer' }}
      onClick={e => {
        e.stopPropagation();
        window.open(url, '_blank', 'noopener,noreferrer');
      }}
    />
  );
}

interface TaskTrendChartProps {
  data: TrendMonthPoint[];
}

export default function TaskTrendChart({ data }: TaskTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip labelFormatter={label => `Month: ${label}`} />
        <Legend />
        <Line
          type="monotone"
          dataKey="incidents"
          stroke="#ef4444"
          strokeWidth={2}
          name="Incidents"
          dot={props => <ClickableDot {...(props as DotRenderProps)} urlKey="incidentListUrl" />}
          activeDot={props => <ClickableDot {...(props as DotRenderProps)} urlKey="incidentListUrl" />}
        />
        <Line
          type="monotone"
          dataKey="changes"
          stroke="#f59e0b"
          strokeWidth={2}
          name="Changes"
          dot={props => <ClickableDot {...(props as DotRenderProps)} urlKey="changeListUrl" />}
          activeDot={props => <ClickableDot {...(props as DotRenderProps)} urlKey="changeListUrl" />}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
