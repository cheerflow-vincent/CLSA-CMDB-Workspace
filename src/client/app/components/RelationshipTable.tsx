import { Search } from 'lucide-react';

const relationshipData = [
  {
    ciName: 'ES - Cobra - HK (HUB)',
    upstream: ['FR - Viper - US', 'DE - Mamba - DE', 'IT - Python - JP', 'PL - Aspic - AU', 'SE - Sidewinder - IN', 'DK - Boomslang - KR', 'IS - Gopher - ZA'],
    downstream: ['FR - Viper - US', 'DE - Mamba - DE', 'IT - Python - JP', 'PL - Aspic - AU', 'SE - Sidewinder - IN', 'DK - Boomslang - KR', 'IS - Gopher - ZA'],
    bidirectional: ['FR - Viper - US', 'DE - Mamba - DE']
  },
  {
    ciName: 'ES - Cobra - TW',
    upstream: [],
    downstream: ['ES - Cobra - HK (HUB)'],
    bidirectional: ['ES - Cobra - HK (HUB)']
  },
  {
    ciName: 'ES - Cobra - IN',
    upstream: [],
    downstream: ['ES - Cobra - HK (HUB)'],
    bidirectional: []
  },
  {
    ciName: 'DS - CRD - Global',
    upstream: ['PT - Rattlesnake - BR'],
    downstream: ['ES - Cobra - HK (HUB)'],
    bidirectional: []
  },
  {
    ciName: 'RS - Research Website',
    upstream: [],
    downstream: ['ES - Cobra - HK (HUB)'],
    bidirectional: []
  },
  {
    ciName: 'RS - Research Website',
    upstream: ['IS - Gopher - ZA'],
    downstream: ['ES - Cobra - HK (HUB)'],
    bidirectional: []
  }
];

export default function RelationshipTable() {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Keyword Search"
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-y border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                CI Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                Upstream Dependencies
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                Downstream Dependencies
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                Bi-directional Dependencies
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {relationshipData.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <button className="text-blue-600 hover:text-blue-800 font-medium text-sm">
                    {row.ciName}
                  </button>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {row.upstream.length === 0 ? (
                      <span className="text-sm text-gray-400">-</span>
                    ) : (
                      row.upstream.map((dep, i) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs"
                        >
                          {dep}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {row.downstream.length === 0 ? (
                      <span className="text-sm text-gray-400">-</span>
                    ) : (
                      row.downstream.map((dep, i) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                        >
                          {dep}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {row.bidirectional.length === 0 ? (
                      <span className="text-sm text-gray-400">-</span>
                    ) : (
                      row.bidirectional.map((dep, i) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs"
                        >
                          {dep}
                        </span>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
