import { Routes, Route, NavLink } from 'react-router-dom'
import { BookOpen, Search, Layers, Upload, Settings, Briefcase } from 'lucide-react'
import SearchPage from './pages/SearchPage'
import CataloguesPage from './pages/CataloguesPage'
import CataloguePage from './pages/CataloguePage'
import PageViewPage from './pages/PageViewPage'
import RefPage from './pages/RefPage'
import AdminImportPage from './pages/admin/AdminImportPage'
import AdminCataloguePage from './pages/admin/AdminCataloguePage'
import AdminPageEditPage from './pages/admin/AdminPageEditPage'
import AdminSourcesPage from './pages/admin/AdminSourcesPage'
import AdminImportsPage from './pages/admin/AdminImportsPage'
import AdminJobsPage from './pages/admin/AdminJobsPage'

const NAV = [
  { to: '/',               icon: Search,   label: 'Recherche' },
  { to: '/catalogues',     icon: BookOpen,  label: 'Catalogues' },
  { to: '/admin/jobs',     icon: Briefcase, label: 'Travaux' },
  { to: '/admin/import',   icon: Upload,    label: 'Importer' },
  { to: '/admin/sources',  icon: Settings,  label: 'Sources' },
]

export default function App() {
  return (
    <>
      <nav className="or-navbar">
        <NavLink className="or-navbar-brand" to="/">
          <Layers size={18} strokeWidth={2.5} />
          OpenRef
        </NavLink>
        <div className="or-navbar-links">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `or-nav-link${isActive ? ' active' : ''}`}
            >
              <Icon size={15} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="or-main">
        <Routes>
          <Route path="/"                       element={<SearchPage />} />
          <Route path="/catalogues"             element={<CataloguesPage />} />
          <Route path="/catalogue/:id"          element={<CataloguePage />} />
          <Route path="/page/:id"               element={<PageViewPage />} />
          <Route path="/ref/:partNumber"        element={<RefPage />} />
          <Route path="/admin/imports"          element={<AdminImportsPage />} />
          <Route path="/admin/jobs"             element={<AdminJobsPage />} />
          <Route path="/admin/import"           element={<AdminImportPage />} />
          <Route path="/admin/catalogue/:id"    element={<AdminCataloguePage />} />
          <Route path="/admin/page/:id/edit"    element={<AdminPageEditPage />} />
          <Route path="/admin/sources"          element={<AdminSourcesPage />} />
        </Routes>
      </main>
    </>
  )
}
