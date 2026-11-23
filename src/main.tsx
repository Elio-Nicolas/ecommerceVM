import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminPanel from './AdminPanel'
import AdminOrders from './AdminOrders'
import AdminSales from './AdminSales'
import AdminProfitability from './AdminProfitability'
import './index.css'
import PaymentReturnPage from './PaymentReturnPage'

const isAdminOrdersRoute = window.location.pathname === '/admin/pedidos'
const isAdminSalesRoute = window.location.pathname === '/admin/ventas'
const isAdminProfitabilityRoute = window.location.pathname === '/admin/rentabilidad'
const isAdminRoute = window.location.pathname.startsWith('/admin')
const paymentParams = new URLSearchParams(window.location.search)
const paymentOutcome = paymentParams.get('payment')
const paymentOrderId = paymentParams.get('order')
const paymentProvider = paymentParams.get('provider') === 'gocuotas' ? 'gocuotas' : 'mercadopago'
const isPaymentReturnRoute = !isAdminRoute
  && ['success', 'failure', 'pending'].includes(paymentOutcome || '')
  && /^[0-9a-f-]{36}$/i.test(paymentOrderId || '')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPaymentReturnRoute ? <PaymentReturnPage orderId={paymentOrderId!} outcome={paymentOutcome as 'success' | 'failure' | 'pending'} provider={paymentProvider} /> : isAdminOrdersRoute ? <AdminOrders />  : isAdminSalesRoute ? <AdminSales /> : isAdminProfitabilityRoute ? <AdminProfitability /> : isAdminRoute ? <AdminPanel /> : <App />}
  </React.StrictMode>,
)
