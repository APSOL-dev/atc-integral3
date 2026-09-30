import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { PERFILES, normalizePerfil } from '../utils/permisos.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [pedidos, setPedidos] = useState([])
  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [descuentosMarca, setDescuentosMarca] = useState(() => {
    try {
      const saved = localStorage.getItem('atc_descuentos_marca')
      if (saved) return JSON.parse(saved)
    } catch (e) {}
    return {}
  })
  const [loading, setLoading] = useState(true) // true by default: first render is always loading
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const lastSyncRef = useRef(null)
  const [secondsLeft, setSecondsLeft] = useState(30)
  const [serverHealth, setServerHealth] = useState({ status: 'ok', mssql: true, supabase: true })
  const [syncStatus, setSyncStatus] = useState(null)
  const [isSyncingMirror, setIsSyncingMirror] = useState(false)

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/sync/estado`)
      if (res.ok) {
        const data = await res.json()
        setSyncStatus(data)
      }
    } catch (e) {}
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/health`)
      if (res.ok || res.status === 503) {
        const data = await res.json()
        setServerHealth(data)
      } else {
        setServerHealth({ status: 'error', mssql: false, supabase: false })
      }
    } catch (e) {
      setServerHealth({ status: 'error', mssql: false, supabase: false })
    }
  }, [])

  useEffect(() => {
    checkHealth()
    fetchSyncStatus()
    const healthInterval = setInterval(checkHealth, 15000)
    const syncStatusInterval = setInterval(fetchSyncStatus, 60000)
    return () => {
      clearInterval(healthInterval)
      clearInterval(syncStatusInterval)
    }
  }, [checkHealth, fetchSyncStatus])

  // Preloading cache for Clientes to achieve instant page transitions
  const [preloadedClientes, setPreloadedClientes] = useState({})
  const pedidosRef = useRef([])
  useEffect(() => {
    pedidosRef.current = pedidos
  }, [pedidos])

  const hydrateDetails = useCallback(async (orderIds) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) return

    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try {
      if (storedUser) userObj = JSON.parse(storedUser)
    } catch (e) {}

    const authHeaders = userObj?.token ? { 'Authorization': `Bearer ${userObj.token}` } : {}

    const currentPedidosMap = new Map(pedidosRef.current.map(p => [String(p.IDPedido), p]))
    const missingIds = orderIds.filter(id => {
      const p = currentPedidosMap.get(String(id))
      return p && (!p.detalles || !Array.isArray(p.detalles) || p.detalles.length === 0)
    })

    if (missingIds.length === 0) return

    try {
      const res = await fetch(`${API_URL}/pedidos/details-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ids: missingIds })
      })

      if (res.ok) {
        const batchDetails = await res.json()
        setPedidos(prev => {
          let updated = false
          const next = prev.map(p => {
            const id = String(p.IDPedido)
            const detailsArr = batchDetails[id]
            if (Array.isArray(detailsArr) && detailsArr.length > 0 && (!p.detalles || p.detalles.length === 0)) {
              updated = true
              return { ...p, detalles: detailsArr }
            }
            return p
          })
          return updated ? next : prev
        })
      }
    } catch (err) {
      console.error('Error hydrating details batch:', err)
    }
  }, [])

  const fetchPedidoById = useCallback(async (id) => {
    if (!id) return null
    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try {
      if (storedUser) userObj = JSON.parse(storedUser)
    } catch (e) {}

    const authHeaders = userObj?.token ? { 'Authorization': `Bearer ${userObj.token}` } : {}

    try {
      const res = await fetch(`${API_URL}/pedidos/${id}`, { headers: authHeaders })
      if (!res.ok) return null
      const data = await res.json()
      if (data && data.IDPedido) {
        setPedidos(prev => {
          const exists = prev.some(p => String(p.IDPedido) === String(id))
          if (exists) {
            return prev.map(p => String(p.IDPedido) === String(id) ? { ...p, ...data } : p)
          } else {
            return [data, ...prev]
          }
        })
        return data
      }
    } catch (err) {
      console.error('Error fetching single pedido by ID:', err)
    }
    return null
  }, [])


  const preloadClientesList = useCallback(async (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return
    const toFetch = ids.filter(id => !preloadedClientes[id])
    if (toFetch.length === 0) return

    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try {
      if (storedUser) userObj = JSON.parse(storedUser)
    } catch (e) {}

    const authHeaders = userObj?.token ? { 'Authorization': `Bearer ${userObj.token}` } : {}

    try {
      const res = await fetch(`${API_URL}/clientes/batch?ids=${toFetch.join(',')}`, {
        headers: authHeaders
      })
      const data = await res.json()
      if (Array.isArray(data)) {
        setPreloadedClientes(prev => {
          const next = { ...prev }
          data.forEach(c => {
            if (c) {
              const cid = c.NRO_CLIENTE || c.id
              if (cid) next[cid] = c
            }
          })
          return next
        })
      }
    } catch (err) {
      console.error('Error preloading clients:', err)
    }
  }, [preloadedClientes])

  // Navigation tracking
  const location = useLocation()
  const [prevPath, setPrevPath] = useState(null)
  const [currentPath, setCurrentPath] = useState(location.pathname)

  useEffect(() => {
    if (location.pathname !== currentPath) {
      setPrevPath(currentPath)
      setCurrentPath(location.pathname)
    }
  }, [location.pathname, currentPath])

  // Pedidos Filters State
  const [activeTab, setActiveTab] = useState('Todos')
  const [filterID, setFilterID] = useState('')
  const [filterCliente, setFilterCliente] = useState('')
  const [filterVendedor, setFilterVendedor] = useState('')
  const [filterFechaDesde, setFilterFechaDesde] = useState('')
  const [filterFechaHasta, setFilterFechaHasta] = useState('')
  const [selectedCliente, setSelectedCliente] = useState(null)
  const [selectedVendedor, setSelectedVendedor] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(40)
  const [sortConfig, setSortConfig] = useState({ key: 'Fecha y hora', direction: 'desc' })

  const resetPedidosFilters = useCallback((searchStr) => {
    const params = new URLSearchParams(searchStr || '')
    const initialEstado = params.get('estado') || 'Todos'
    setActiveTab(initialEstado)
    setFilterID('')
    setFilterCliente('')
    setFilterVendedor('')
    setFilterFechaDesde('')
    setFilterFechaHasta('')
    setSelectedCliente(null)
    setSelectedVendedor(null)
    setCurrentPage(1)
    setPageSize(40)
    setSortConfig({ key: 'Fecha y hora', direction: 'desc' })
  }, [])

  const fetchPedidos = useCallback(async (showLoading = false, force = false) => {
    // --- Auth guard: don't fetch without a valid token ---
    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try {
      if (storedUser) userObj = JSON.parse(storedUser)
    } catch (e) {}

    if (!userObj?.token) {
      // Not authenticated yet — show nothing, don't mark as synced
      setLoading(false)
      return
    }

    const now = new Date()
    // Skip if not forced, and lastSync is within 5 minutes
    if (!force && lastSyncRef.current && (now - lastSyncRef.current) < 5 * 60 * 1000) {
      // Data is still fresh — ensure loading spinner doesn't get stuck
      setLoading(false)
      return
    }

    if (showLoading) {
      setLoading(true)
    } else {
      setIsRefreshing(true)
    }

    const profile = userObj ? normalizePerfil(userObj.perfil) : null
    const isAdmin = profile === 'Administracion' || profile === 'AdministracionA'
    const headers = { 'Authorization': `Bearer ${userObj.token}` }

    // 1. Fetch Pedidos (Lightweight header list for instant boot)
    fetch(`${API_URL}/pedidos`, { headers })
      .then(async res => {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem('atc_user')
          window.location.href = '/login'
          return
        }
        if (!res.ok) {
          throw new Error(`Server returned status ${res.status}`)
        }
        const data = await res.json().catch(() => [])
        setPedidos(prev => {
          if (!Array.isArray(data)) return prev
          const detallesMap = new Map()
          prev.forEach(p => {
            if (p.detalles && p.detalles.length > 0) {
              detallesMap.set(String(p.IDPedido), p.detalles)
            }
          })
          return data.map(p => {
            const idStr = String(p.IDPedido)
            if (detallesMap.has(idStr)) {
              return { ...p, detalles: detallesMap.get(idStr) }
            }
            return p
          })
        })
        const syncDate = new Date()
        setLastSync(syncDate)
        lastSyncRef.current = syncDate
        setSecondsLeft(30) // Reset countdown on successful sync
      })
      .catch(err => {
        console.error('Error fetching pedidos:', err)
        const syncDate = new Date()
        setLastSync(syncDate)
        lastSyncRef.current = syncDate
      })
      .finally(() => {
        setLoading(false)
        setIsRefreshing(false)
      })

    // 2. Fetch Clientes in background
    fetch(`${API_URL}/clientes`, { headers })
      .then(async res => res.ok ? res.json() : [])
      .then(data => setClientes(Array.isArray(data) ? data : []))
      .catch(err => console.error('Error fetching clientes:', err))

    // 3. Fetch Productos in background
    fetch(`${API_URL}/productos`, { headers })
      .then(async res => res.ok ? res.json() : [])
      .then(data => setProductos(Array.isArray(data) ? data : []))
      .catch(err => console.error('Error fetching productos:', err))

    // 4. Fetch Descuentos por Marca para todos los usuarios autenticados
    fetch(`${API_URL}/descuentos-marca`, { headers })
      .then(async res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          const map = {}
          data.forEach(item => { if (item.marca) map[item.marca] = item.porcentaje })
          setDescuentosMarca(map)
          localStorage.setItem('atc_descuentos_marca', JSON.stringify(map))
        }
      })
      .catch(err => console.error('Error fetching descuentos marca:', err))

    // 5. Fetch Usuarios in background if admin
    if (isAdmin) {
      fetch(`${API_URL}/usuarios`, { headers })
        .then(async res => res.ok ? res.json() : [])
        .then(data => setUsuarios(Array.isArray(data) ? data : []))
        .catch(err => console.error('Error fetching usuarios:', err))
    }
  }, [])

  const fetchDescuentosMarca = useCallback(async () => {
    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try { if (storedUser) userObj = JSON.parse(storedUser) } catch {}
    const headers = userObj?.token ? { 'Authorization': `Bearer ${userObj.token}` } : {}

    try {
      const res = await fetch(`${API_URL}/descuentos-marca`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          const map = {}
          data.forEach(item => { if (item.marca) map[item.marca] = item.porcentaje })
          setDescuentosMarca(map)
          localStorage.setItem('atc_descuentos_marca', JSON.stringify(map))
        }
      }
    } catch (e) {
      console.error('Error refreshing descuentos marca:', e)
    }
  }, [])

  const saveDescuentoMarca = useCallback((marca, porcentaje) => {
    if (!marca) return
    const cleanMarca = String(marca).trim()
    const numericPct = parseFloat(porcentaje) || 0

    setDescuentosMarca(prev => {
      const next = { ...prev, [cleanMarca]: numericPct }
      localStorage.setItem('atc_descuentos_marca', JSON.stringify(next))
      return next
    })

    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try { if (storedUser) userObj = JSON.parse(storedUser) } catch {}
    const headers = {
      'Content-Type': 'application/json',
      ...(userObj?.token ? { 'Authorization': `Bearer ${userObj.token}` } : {})
    }

    fetch(`${API_URL}/descuentos-marca`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ marca: cleanMarca, porcentaje: numericPct, activo: true })
    }).then(() => fetchDescuentosMarca())
      .catch(err => console.error('Error saving descuento marca to server:', err))
  }, [fetchDescuentosMarca])

  const removeDescuentoMarca = useCallback((marca) => {
    if (!marca) return
    const cleanMarca = String(marca).trim()

    setDescuentosMarca(prev => {
      const next = { ...prev }
      delete next[cleanMarca]
      Object.keys(next).forEach(k => {
        if (k.toLowerCase() === cleanMarca.toLowerCase()) delete next[k]
      })
      localStorage.setItem('atc_descuentos_marca', JSON.stringify(next))
      return next
    })

    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try { if (storedUser) userObj = JSON.parse(storedUser) } catch {}
    const headers = userObj?.token ? { 'Authorization': `Bearer ${userObj.token}` } : {}

    fetch(`${API_URL}/descuentos-marca/${encodeURIComponent(cleanMarca)}`, {
      method: 'DELETE',
      headers
    }).then(() => fetchDescuentosMarca())
      .catch(err => console.error('Error removing descuento marca from server:', err))
  }, [fetchDescuentosMarca])

  const forceMirrorSync = useCallback(async () => {
    const storedUser = localStorage.getItem('atc_user')
    let userObj = null
    try { if (storedUser) userObj = JSON.parse(storedUser) } catch {}
    const headers = userObj?.token ? { 'Authorization': `Bearer ${userObj.token}` } : {}

    setIsSyncingMirror(true)
    try {
      const res = await fetch(`${API_URL}/sync/forzar`, { method: 'POST', headers })
      const data = await res.json()
      if (data?.resultado) {
        setSyncStatus(data.resultado)
      }
      await fetchPedidos(false, true)
      return { success: true, data }
    } catch (err) {
      console.error('Error in forceMirrorSync:', err)
      return { success: false, error: err.message }
    } finally {
      setIsSyncingMirror(false)
    }
  }, [fetchPedidos])

  // Reactive initial fetch when entering wholesale app routes or when token is ready
  useEffect(() => {
    const isWholesaleRoute = location.pathname.startsWith('/atc') || 
                             location.pathname.startsWith('/pedidos') || 
                             location.pathname.startsWith('/clientes') || 
                             location.pathname.startsWith('/productos')

    const storedUser = localStorage.getItem('atc_user')
    let hasToken = false
    try {
      if (storedUser) hasToken = !!JSON.parse(storedUser)?.token
    } catch {}

    if (hasToken && isWholesaleRoute && !lastSyncRef.current) {
      fetchPedidos(true, true)
    }
  }, [location.pathname, fetchPedidos])

  // Auto background sync every 30 seconds silently
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPedidos(false, true)
    }, 30 * 1000)
    return () => clearInterval(interval)
  }, [fetchPedidos])

  return (
    <DataContext.Provider value={{ 
      preloadedClientes,
      preloadClientesList,
      hydrateDetails,
      fetchPedidoById,
      pedidos, 
      setPedidos, 
      clientes,
      setClientes,
      productos,
      setProductos,
      usuarios,
      setUsuarios,
      descuentosMarca,
      saveDescuentoMarca,
      removeDescuentoMarca,
      loading, 
      isRefreshing,
      lastSync,
      isReady: lastSync !== null, 
      fetchPedidos,
      secondsLeft,
      serverHealth,
      syncStatus,
      isSyncingMirror,
      forceMirrorSync,
      // Navigation
      prevPath,
      // Pedidos Filters & Page size
      activeTab,
      setActiveTab,
      filterID,
      setFilterID,
      filterCliente,
      setFilterCliente,
      filterVendedor,
      setFilterVendedor,
      filterFechaDesde,
      setFilterFechaDesde,
      filterFechaHasta,
      setFilterFechaHasta,
      selectedCliente,
      setSelectedCliente,
      selectedVendedor,
      setSelectedVendedor,
      currentPage,
      setCurrentPage,
      pageSize,
      setPageSize,
      sortConfig,
      setSortConfig,
      resetPedidosFilters
    }}>
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be inside DataProvider')
  return ctx
}
