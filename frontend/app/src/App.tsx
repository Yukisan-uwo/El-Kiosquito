import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'
import { MotionProvider } from '@/app/MotionProvider'
import { RutaProtegida } from '@/app/RutaProtegida'
import { AuthProvider, useAuth } from '@/auth/AuthContext'
import { rutaInicialParaRol } from '@/auth/roles'
import { Login } from '@/screens/Login/Login'
import { DashboardDueno } from '@/screens/DashboardDueno/DashboardDueno'
import { PosCajero } from '@/screens/PosCajero/PosCajero'
import { DashboardSucursal } from '@/screens/DashboardSucursal/DashboardSucursal'
import { Compras } from '@/screens/Compras/Compras'
import { Administracion } from '@/screens/Administracion/Administracion'

function RedireccionInicial() {
  const { sesion, cargandoSesionInicial } = useAuth()
  if (cargandoSesionInicial) return null
  return <Navigate to={sesion ? rutaInicialParaRol(sesion.rol) : '/login'} replace />
}

export function App() {
  return (
    <AuthProvider>
      <MotionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/dueno"
              element={
                <RutaProtegida modulo="dashboard_dueno">
                  <AppShell><DashboardDueno /></AppShell>
                </RutaProtegida>
              }
            />
            <Route
              path="/pos"
              element={
                <RutaProtegida modulo="pos_cajero">
                  <AppShell><PosCajero /></AppShell>
                </RutaProtegida>
              }
            />
            <Route
              path="/sucursal"
              element={
                <RutaProtegida modulo="dashboard_sucursal">
                  <AppShell><DashboardSucursal /></AppShell>
                </RutaProtegida>
              }
            />
            <Route
              path="/compras"
              element={
                <RutaProtegida modulo="compras_proveedores">
                  <AppShell><Compras /></AppShell>
                </RutaProtegida>
              }
            />
            <Route
              path="/admin"
              element={
                <RutaProtegida modulo="administracion">
                  <AppShell><Administracion /></AppShell>
                </RutaProtegida>
              }
            />
            <Route path="/" element={<RedireccionInicial />} />
          </Routes>
        </BrowserRouter>
      </MotionProvider>
    </AuthProvider>
  )
}
