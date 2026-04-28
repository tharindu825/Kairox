export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div>
        <div className="kx-skeleton h-8 w-48 mb-2" />
        <div className="kx-skeleton h-4 w-72" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="kx-card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="kx-skeleton w-10 h-10 rounded-lg" />
              <div className="kx-skeleton w-12 h-6 rounded-md" />
            </div>
            <div className="kx-skeleton h-8 w-24 mb-2" />
            <div className="kx-skeleton h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="kx-card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="kx-skeleton h-6 w-24" />
                <div className="kx-skeleton h-5 w-16 rounded-md" />
                <div className="kx-skeleton h-5 w-20 rounded-md" />
              </div>
              <div className="space-y-2">
                <div className="kx-skeleton h-4 w-full" />
                <div className="kx-skeleton h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="kx-card p-5">
            <div className="kx-skeleton h-5 w-32 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex justify-between">
                  <div className="kx-skeleton h-4 w-24" />
                  <div className="kx-skeleton h-4 w-12" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
