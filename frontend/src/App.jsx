import { Routes, Route, Link } from 'react-router-dom'
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

export default function App() {
  return (
    <>
      <nav className="navbar is-dark" role="navigation">
        <div className="navbar-brand">
          <Link className="navbar-item has-text-weight-bold" to="/">OpenRef</Link>
        </div>
        <div className="navbar-menu">
          <div className="navbar-start">
            <Link className="navbar-item" to="/catalogues">Catalogues</Link>
            <Link className="navbar-item" to="/admin/jobs">Travaux</Link>
            <Link className="navbar-item" to="/admin/import">Importer</Link>
            <Link className="navbar-item" to="/admin/sources">Sources</Link>
          </div>
        </div>
      </nav>

      <main className="container" style={{ marginTop: '2rem', paddingBottom: '4rem' }}>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/catalogues" element={<CataloguesPage />} />
          <Route path="/catalogue/:id" element={<CataloguePage />} />
          <Route path="/page/:id" element={<PageViewPage />} />
          <Route path="/ref/:partNumber" element={<RefPage />} />
          <Route path="/admin/imports" element={<AdminImportsPage />} />
          <Route path="/admin/jobs" element={<AdminJobsPage />} />
          <Route path="/admin/import" element={<AdminImportPage />} />
          <Route path="/admin/catalogue/:id" element={<AdminCataloguePage />} />
          <Route path="/admin/page/:id/edit" element={<AdminPageEditPage />} />
          <Route path="/admin/sources" element={<AdminSourcesPage />} />
        </Routes>
      </main>
    </>
  )
}
