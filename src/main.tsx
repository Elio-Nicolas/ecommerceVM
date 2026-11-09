import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminPanel from './AdminPanel'
import AdminOrders from './AdminOrders'
import './index.css'

const isAdminOrdersRoute = window.location.pathname === '/admin/pedidos'
const isAdminRoute = window.location.pathname.startsWith('/admin')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdminOrdersRoute ? <AdminOrders /> : isAdminRoute ? <AdminPanel /> : <App />}
  </React.StrictMode>,
)
