import { useState } from 'react'
import PageLayout from '../components/layout/PageLayout'
import Footer from '../components/layout/Footer'
import VehicleCard from '../components/sections/VehicleCard'
import PriceModeToggle from '../components/sections/PriceModeToggle'
import { useVehicles } from '../hooks/useVehicles'
import { USE_CASES } from '@/lib/constants'

const priceSorts = [
  { value: 'Price: Low to High', label: 'Low to High', icon: 'arrow_upward' },
  { value: 'Price: High to Low', label: 'High to Low', icon: 'arrow_downward' },
]

export default function BrowsePage() {
  const { vehicles, sort, setSort, useCase, setUseCase, setSearchCity } = useVehicles()
  const [locationQuery, setLocationQuery] = useState('')

  const handleLocationChange = (val) => {
    setLocationQuery(val)
    setSearchCity(val)
  }

  const activeUseCase = USE_CASES.find(u => u.id === useCase)

  return (
    <PageLayout>
      <main className="max-w-screen-2xl mx-auto px-gutter py-10 flex gap-gutter">
        {/* ── Sidebar ── */}
        <aside className="w-[280px] shrink-0 hidden lg:block">
          <div className="sticky top-28 space-y-8">
            <div>
              <h3 className="font-headline-sm text-headline-sm mb-4 text-primary">Filters</h3>
              <div className="space-y-8">
                {/* Location */}
                <div>
                  <label className="font-bold text-label-md font-label-md block mb-3">Location</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">location_on</span>
                    <input
                      className="w-full h-12 pl-10 pr-4 rounded-[10px] bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary outline-none text-body-lg font-body-lg"
                      placeholder="Search Dehradun..."
                      type="text"
                      value={locationQuery}
                      onChange={e => handleLocationChange(e.target.value)}
                    />
                  </div>
                </div>

                {/* Price sort */}
                <div>
                  <label className="font-bold text-label-md font-label-md block mb-3">Price</label>
                  <div className="flex flex-col gap-2">
                    {priceSorts.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setSort(sort === p.value ? 'Recommended' : p.value)}
                        className={`flex items-center gap-2 px-4 h-11 rounded-[10px] text-label-md font-bold transition-all ${
                          sort === p.value
                            ? 'bg-primary-container text-white'
                            : 'bg-surface-container-low border border-outline-variant text-on-surface-variant hover:border-primary'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{p.icon}</span>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Use Case */}
                <div>
                  <label className="font-bold text-label-md font-label-md block mb-3">Use Case</label>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setUseCase('All')}
                      className={`flex items-center gap-3 px-4 py-3 rounded-[10px] text-left transition-all ${
                        useCase === 'All'
                          ? 'bg-primary-container text-white'
                          : 'bg-surface-container-low border border-outline-variant text-on-surface-variant hover:border-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[22px]">apps</span>
                      <span className="font-bold text-label-md">All Vehicles</span>
                    </button>
                    {USE_CASES.map(u => (
                      <button
                        key={u.id}
                        onClick={() => setUseCase(useCase === u.id ? 'All' : u.id)}
                        className={`flex items-start gap-3 px-4 py-3 rounded-[10px] text-left transition-all ${
                          useCase === u.id
                            ? 'bg-primary-container text-white'
                            : 'bg-surface-container-low border border-outline-variant hover:border-primary'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[22px] mt-0.5">{u.icon}</span>
                        <span>
                          <span className="font-bold text-label-md block">{u.label}</span>
                          <span className={`text-xs ${useCase === u.id ? 'text-white/80' : 'text-on-surface-variant'}`}>{u.desc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Vehicle Grid ── */}
        <section className="flex-1">
          {/* Header */}
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
            <div>
              <h1 className="font-headline-md text-headline-md text-on-surface tracking-tight">
                {activeUseCase ? `${activeUseCase.label} Vehicles` : 'Available Vehicles'}
              </h1>
              <p className="text-on-surface-variant font-body-lg text-body-lg">
                Showing {vehicles.length} results in {locationQuery || 'Dehradun'}
              </p>
            </div>
            <div className="flex items-center gap-4 w-full md:w-auto flex-wrap">
              <PriceModeToggle />
              <span className="text-label-md font-label-md font-bold text-on-surface-variant whitespace-nowrap">Sort by:</span>
              <select
                id="sort-select"
                value={sort}
                onChange={e => setSort(e.target.value)}
                className="flex-1 md:flex-none h-10 px-4 rounded-lg bg-surface-container-low border border-outline-variant text-label-md font-medium focus:ring-1 focus:ring-primary outline-none"
              >
                <option>Recommended</option>
                <option>Price: Low to High</option>
                <option>Price: High to Low</option>
                <option>Top Rated</option>
              </select>
            </div>
          </header>

          {/* Mobile filter chips */}
          <div className="lg:hidden flex items-center gap-2 overflow-x-auto hide-scrollbar mb-6 pb-1">
            <button
              onClick={() => setUseCase('All')}
              className={`px-4 py-2 rounded-full text-label-md font-bold whitespace-nowrap transition-all ${
                useCase === 'All' ? 'bg-primary-container text-white' : 'bg-surface-container-low border border-outline-variant text-on-surface-variant'
              }`}
            >
              All
            </button>
            {USE_CASES.map(u => (
              <button
                key={u.id}
                onClick={() => setUseCase(useCase === u.id ? 'All' : u.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-label-md font-bold whitespace-nowrap transition-all ${
                  useCase === u.id ? 'bg-primary-container text-white' : 'bg-surface-container-low border border-outline-variant text-on-surface-variant'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{u.icon}</span>
                {u.label}
              </button>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 overflow-visible">
            {vehicles.map(v => (
              <VehicleCard key={v.id} vehicle={v} />
            ))}
            {vehicles.length === 0 && (
              <div className="col-span-full text-center py-24 text-on-surface-variant">
                <span className="material-symbols-outlined text-[64px] block mb-4">search_off</span>
                <p className="font-headline-sm text-headline-sm">No vehicles match your filters</p>
              </div>
            )}
          </div>

          {/* Load More */}
          <div className="mt-16 flex flex-col items-center gap-6">
            <button className="px-10 py-4 bg-surface-container-lowest border border-primary text-primary font-bold rounded-full hover:bg-primary-fixed transition-colors">
              Load More Vehicles
            </button>
            <div className="flex gap-2">
              {[1, 2, 3].map(n => (
                <button
                  key={n}
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    n === 1 ? 'bg-primary-container text-white' : 'bg-surface hover:bg-surface-container transition-colors'
                  }`}
                >
                  {n}
                </button>
              ))}
              <span className="flex items-center justify-center px-2">...</span>
              <button className="w-10 h-10 rounded-full flex items-center justify-center bg-surface hover:bg-surface-container transition-colors">12</button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </PageLayout>
  )
}
