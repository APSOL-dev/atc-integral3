import { useState } from 'react'
import { Outlet, Navigate, useLocation, useNavigate, NavLink } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { getSidebarItems } from '../../utils/permisos.js'
import { 
  Bell, RefreshCw, Menu, X, LayoutDashboard, 
  ShoppingCart, Users, Package, Settings, BarChart2, LogOut 
} from 'lucide-react'
import { useData } from '../../context/DataContext.jsx'

const routeTitles = {
  '/': 'Panel Principal',
  '/atc': 'Panel Principal',
  '/pedidos': 'Listado de Pedidos',
  '/clientes': 'Gestión de Clientes',
  '/productos': 'Catálogo de Productos',
  '/pagos': 'Registro de Pagos',
  '/saldos': 'Saldos y Cuentas',
  '/admin/usuarios': 'Configuración de Usuarios',
  '/perfil': 'Mi Perfil',
}

const NAV_ITEMS = [
  { key: 'dashboard',  label: 'Principal',   icon: LayoutDashboard, path: '/atc' },
  { key: 'pedidos',    label: 'Pedidos',      icon: ShoppingCart,    path: '/pedidos' },
  { key: 'clientes',   label: 'Clientes',     icon: Users,           path: '/clientes' },
  { key: 'productos',  label: 'Productos',    icon: Package,         path: '/productos' },
  { key: 'usuarios',   label: 'Usuarios',     icon: Settings,        path: '/admin/usuarios' },
  { key: 'selector',   label: 'Cambiar App',  icon: BarChart2,       path: '/selector' },
]

export default function AppLayout() {
  const { user, logout, loading } = useAuth()
  const { serverHealth, isSyncingMirror, forceMirrorSync, syncStatus } = useData()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  
  const title = routeTitles[location.pathname] || 'A Todo Color'
  const allowed = getSidebarItems(user?.perfil || 'VendedorCalle')
  const visibleItems = NAV_ITEMS.filter(item => allowed.includes(item.key))

  function handleLogout() {
    logout()
    navigate('/login')
  }

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#f8fafc]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-[#0f5da9] border-t-transparent rounded-full animate-spin" />
        <p className="text-[#1e293b] font-bold text-sm uppercase tracking-widest">Cargando Sistema...</p>
      </div>
    </div>
  )

  if (!user) return <Navigate to="/login" replace />

  const avatarUrl = `https://ui-avatars.com/api/?name=${user?.nombre || 'User'}&background=random`

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc]">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-4/5 max-w-xs bg-[#0f5da9] text-white flex flex-col h-full z-10 p-5 shadow-2xl animate-slide-in-left">
            <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
              <div className="bg-white/95 p-2.5 rounded-2xl max-w-[120px]">
                <img src="/logo.png" alt="Logo" className="w-full h-auto object-contain" />
              </div>
              <button 
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-xl text-white/80 hover:bg-white/10 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Mobile Nav Links */}
            <nav className="flex flex-col gap-1.5 flex-1 overflow-y-auto no-scrollbar">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.key}
                  to={item.path}
                  end={item.path === '/atc'}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-3 rounded-xl font-bold transition-all ${
                      isActive
                        ? 'bg-white text-[#0f5da9] shadow-md'
                        : 'text-white/80 hover:bg-white/10'
                    }`
                  }
                >
                  <item.icon size={18} />
                  <span className="text-sm tracking-tight">{item.label}</span>
                </NavLink>
              ))}
            </nav>

            {/* Mobile User Profile Footer */}
            <div className="pt-4 border-t border-white/10 mt-auto flex flex-col gap-2">
              <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
                <img src={avatarUrl} alt="Avatar" className="size-8 rounded-full border border-white/20" />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold truncate">{user?.nombre || 'Usuario'}</span>
                  <span className="text-[10px] text-white/60 uppercase truncate">{user?.perfil || 'Perfil'}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  setMobileMenuOpen(false)
                  handleLogout()
                }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-red-200 hover:bg-red-500/20 font-bold text-xs"
              >
                <LogOut size={16} />
                <span>Cerrar Sesión</span>
              </button>

              <div className="text-center text-[10px] text-white/30 font-bold mt-2 tracking-widest uppercase">
                v2.6
              </div>
            </div>
          </aside>
        </div>
      )}
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Brand Header */}
        <header className="flex items-center justify-between bg-white/80 backdrop-blur-xl px-4 sm:px-8 py-3.5 sticky top-0 z-30 transition-all border-b border-[#f8fafc]">
          <div className="flex items-center gap-3">
            {/* Hamburger Button on Mobile */}
            <button 
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-all"
              aria-label="Abrir menú"
            >
              <Menu size={22} />
            </button>

            <div className="flex flex-col text-left">
              <span className="text-lg sm:text-xl font-bold text-[#1e293b] tracking-tight truncate max-w-[160px] sm:max-w-none">
                {title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Sincronizar Espejo Button */}
            <button
              onClick={() => forceMirrorSync()}
              disabled={isSyncingMirror}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                isSyncingMirror
                  ? 'bg-blue-50 text-[#0f5da9] border-blue-200 cursor-not-allowed'
                  : 'bg-white text-slate-700 hover:text-[#0f5da9] hover:bg-blue-50/50 border-slate-200 shadow-sm'
              }`}
              title="Sincronizar catálogo y pedidos con SQL Server"
            >
              <RefreshCw size={14} className={isSyncingMirror ? 'animate-spin text-[#0f5da9]' : ''} />
              <span className="hidden sm:inline">{isSyncingMirror ? 'Sincronizando...' : 'Sincronizar'}</span>
            </button>

            <div className="hidden md:flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-widest text-[#1e293b]/40 font-bold">Estado</span>
              {serverHealth?.supabase ? (
                serverHealth?.mssql ? (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5" title="Conexión en tiempo real con SQL Server y Supabase">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    En Línea (SQL Server)
                  </span>
                ) : (
                  <span className="text-xs font-bold text-sky-600 flex items-center gap-1.5" title="Operando con base de datos espejo en Supabase. Los cambios se sincronizarán al reconectar.">
                    <span className="size-1.5 rounded-full bg-sky-500" />
                    Espejo Supabase (Offline-Ready)
                  </span>
                )
              ) : (
                <span className="text-xs font-bold text-red-500 flex items-center gap-1.5" title="Sin conexión con el servidor principal">
                  <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
                  Sin conexión
                </span>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 animate-fade-in no-scrollbar">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
