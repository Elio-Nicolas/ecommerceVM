import { useEffect, useMemo, useState } from 'react'
import { formatPrice, type Product } from './products'
import { fetchCategories, fetchProducts } from './catalog-api'
import CheckoutPage from './CheckoutPage'

type CartLine = { product: Product; quantity: number }

const CART_STORAGE_KEY = 'ecommercevm:cart:v1'

function getProductSlugFromPath() {
  const match = window.location.pathname.match(/^\/producto\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
}
function BagIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>
}
function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>(['Todos'])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [category, setCategory] = useState('Todos')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('featured')
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY)
      if (!saved) return []
      const parsed = JSON.parse(saved) as CartLine[]
      if (!Array.isArray(parsed)) return []
      return parsed.filter((line) =>
        line && line.product && typeof line.product.id === 'string' &&
        Number.isInteger(line.quantity) && line.quantity > 0 &&
        typeof line.product.price === 'number',
      )
    } catch {
      return []
    }
  })
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [selected, setSelected] = useState<Product | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchProducts(), fetchCategories()])
      .then(([items, categoryNames]) => {
        if (!active) return
        setProducts(items)
        setCart((current) => current.flatMap((line) => {
          const latest = items.find((item) => item.id === line.product.id)
          if (!latest || latest.stock <= 0) return []
          return [{ product: latest, quantity: Math.min(line.quantity, latest.stock) }]
        }))
        setCategories(['Todos', ...categoryNames])
        const requestedSlug = getProductSlugFromPath()
        if (requestedSlug) {
          const requestedProduct = items.find((item) => item.slug === requestedSlug)
          if (requestedProduct) setSelected(requestedProduct)
        }
        setCatalogError('')
      })
      .catch(() => {
        if (active) setCatalogError('No pudimos cargar el catálogo. Verificá que la API esté funcionando.')
      })
      .finally(() => {
        if (active) setCatalogLoading(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))
    } catch {
      // Si el almacenamiento del navegador está bloqueado, el carrito sigue funcionando en memoria.
    }
  }, [cart])

  useEffect(() => {
    const syncProductRoute = () => {
      const slug = getProductSlugFromPath()
      setSelected(slug ? products.find((item) => item.slug === slug) ?? null : null)
    }
    window.addEventListener('popstate', syncProductRoute)
    return () => window.removeEventListener('popstate', syncProductRoute)
  }, [products])

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es')
    const result = products.filter((product) =>
      (category === 'Todos' || product.category === category) &&
      (!normalized || `${product.name} ${product.category} ${product.description}`.toLocaleLowerCase('es').includes(normalized)),
    )
    if (sort === 'price-asc') result.sort((a, b) => a.price - b.price)
    if (sort === 'price-desc') result.sort((a, b) => b.price - a.price)
    if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    if (sort === 'featured') result.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
    return result
  }, [products, category, query, sort])

  const cartCount = cart.reduce((total, line) => total + line.quantity, 0)
  const cartTotal = cart.reduce((total, line) => total + line.product.price * line.quantity, 0)

  function openProduct(product: Product) {
    window.history.pushState({}, '', `/producto/${encodeURIComponent(product.slug)}`)
    setSelected(product)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function closeProduct() {
    window.history.pushState({}, '', '/')
    setSelected(null)
  }

  function addToCart(product: Product) {
    if (product.stock <= 0) return
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id)
      if (existing) {
        return current.map((line) => line.product.id === product.id
          ? { ...line, product, quantity: Math.min(line.quantity + 1, product.stock) }
          : line)
      }
      return [...current, { product, quantity: 1 }]
    })
    setCartOpen(true)
  }

  function changeQuantity(id: string, delta: number) {
    setCart((current) => current
      .map((line) => line.product.id === id
        ? { ...line, quantity: Math.max(0, Math.min(line.quantity + delta, line.product.stock)) }
        : line)
      .filter((line) => line.quantity > 0))
  }

  return (
    <div className="site-shell">
      <div className="announcement">Envíos a todo el país <span>·</span> Tecnología útil para todos los días</div>
      <header className="header">
        <a className="brand" href="#" aria-label="Tu TiendaVM inicio">
          <span className="brand-mark">T<span>V</span></span>
          <span className="brand-name">Tu Tienda<span>VM</span></span>
        </a>
        <label className="search-box">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="¿Qué estás buscando?" aria-label="Buscar productos" />
          <kbd>Buscar</kbd>
        </label>
        <div className="header-actions">
          <button className="text-action" onClick={() => document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth' })}>Explorar</button>
          <button className="cart-button" onClick={() => setCartOpen(true)} aria-label={`Abrir carrito, ${cartCount} productos`}>
            <BagIcon /><span>Mi carrito</span>{cartCount > 0 && <b>{cartCount}</b>}
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> TECNOLOGÍA PARA TU DÍA A DÍA</div>
            <h1>Pequeñas ideas.<br /><em>Grandes soluciones.</em></h1>
            <p>Descubrí gadgets, accesorios y tecnología inteligente que hacen tu día más simple.</p>
            <a className="primary-button" href="#catalogo">Explorar productos <ArrowIcon /></a>
            <div className="hero-note"><span className="note-dot" /> Selección de productos prácticos y funcionales</div>
          </div>
          <div className="hero-visual">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <img src="https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1100&q=90" alt="Dispositivos y tecnología retro" />
            <div className="floating-tag"><span>IDEAS QUE</span><strong>INSPIRAN</strong></div>
            <div className="hero-index">01 <span>/</span> 04</div>
          </div>
          <div className="hero-side-label">CURATED TECH · ARGENTINA</div>
        </section>

        <section className="benefits" aria-label="Ventajas">
          <div><span className="benefit-icon">01</span><p><strong>Elegidos con criterio</strong><small>Productos útiles, sin vueltas</small></p></div>
          <div><span className="benefit-icon">02</span><p><strong>Comprá desde donde estés</strong><small>Envíos a toda Argentina</small></p></div>
          <div><span className="benefit-icon">03</span><p><strong>Atención cercana</strong><small>Te ayudamos a elegir</small></p></div>
        </section>

        <section className="catalog-section" id="catalogo">
          <div className="section-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> NUESTRA SELECCIÓN</div><h2>Encontrá algo <em>que te sirva.</em></h2></div>
            <p>Soluciones simples, tecnología práctica y esos productos que no sabías que necesitabas.</p>
          </div>
          <div className="catalog-toolbar">
            <div className="category-tabs" aria-label="Filtrar por categoría">
              {categories.map((item) => <button key={item} className={category === item ? 'category-tab active' : 'category-tab'} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
            <label className="sort-control"><span>Ordenar:</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Destacados</option><option value="price-asc">Menor precio</option><option value="price-desc">Mayor precio</option><option value="name">Nombre</option></select></label>
          </div>
          <div className="results-line"><span>{visibleProducts.length} productos</span><span>Precios de muestra · Valores editables</span></div>
          {catalogLoading ? <div className="empty-results"><strong>Cargando catálogo...</strong></div> : catalogError ? <div className="empty-results"><strong>No se pudo cargar el catálogo.</strong><span>{catalogError}</span></div> : visibleProducts.length ? (
            <div className="product-grid">
              {visibleProducts.map((product) => (
                <article className="product-card" key={product.id}>
                  <button className="product-image" onClick={() => openProduct(product)} aria-label={`Ver ${product.name}`}>
                    <img src={product.image} alt={product.name} loading="lazy" />
                    {product.badge && <span className="product-badge">{product.badge}</span>}
                    <span className="quick-view">Vista rápida <ArrowIcon /></span>
                  </button>
                  <div className="product-info">
                    <span className="product-category">{product.category}</span>
                    <button className="product-name" onClick={() => openProduct(product)}>{product.name}</button>
                    <div className="price-row"><strong>{formatPrice(product.price)}</strong>{product.oldPrice && <del>{formatPrice(product.oldPrice)}</del>}</div>
                    <button className="add-button" onClick={() => addToCart(product)} disabled={product.stock <= 0}>{product.stock > 0 ? 'Agregar al carrito' : 'Sin stock'} <span>{product.stock > 0 ? '+' : '—'}</span></button>
                    <small className="product-stock">{product.stock > 0 ? `${product.stock} disponibles` : 'Agotado'}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty-results"><strong>No encontramos productos.</strong><span>Probá con otra búsqueda o categoría.</span><button onClick={() => { setQuery(''); setCategory('Todos') }}>Ver todos los productos</button></div>}
        </section>

        <section className="closing-banner">
          <div><span className="eyebrow">TECNOLOGÍA SIN COMPLICACIONES</span><h2>Lo útil también<br /><em>puede sorprender.</em></h2></div>
          <a href="#catalogo" className="banner-link">Descubrí la selección <ArrowIcon /></a>
          <span className="banner-decoration">TV</span>
        </section>
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#"><span className="brand-mark">T<span>V</span></span><span className="brand-name">Tu Tienda<span>VM</span></span></a>
        <p>Una nueva forma de encontrar tecnología útil.</p>
        <div className="footer-bottom"><span>© 2026 Tu TiendaVM. Todos los derechos reservados.</span><span>Una marca independiente · Tecnología para todos</span></div>
      </footer>

      {cartOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}>
        <aside className="cart-panel">
          <div className="panel-heading"><div><span className="eyebrow">TU SELECCIÓN</span><h2>Mi carrito <span>({cartCount})</span></h2></div><button className="close-button" onClick={() => setCartOpen(false)} aria-label="Cerrar carrito">×</button></div>
          {cart.length ? <>
            <div className="cart-lines">{cart.map((line) => <div className="cart-line" key={line.product.id}>
              <img src={line.product.image} alt="" />
              <div className="cart-line-info"><strong>{line.product.name}</strong><span>{formatPrice(line.product.price)}</span><div className="quantity-control"><button onClick={() => changeQuantity(line.product.id, -1)} aria-label="Quitar una unidad">−</button><span>{line.quantity}</span><button onClick={() => changeQuantity(line.product.id, 1)} aria-label="Agregar una unidad">+</button></div></div>
              <button className="remove-line" onClick={() => setCart((current) => current.filter((item) => item.product.id !== line.product.id))}>Quitar</button>
            </div>)}</div>
            <div className="cart-summary"><div><span>Subtotal</span><strong>{formatPrice(cartTotal)}</strong></div><small>El costo de envío se calcula más adelante.</small><button className="checkout-continue" onClick={() => { setCartOpen(false); setCheckoutOpen(true) }}>Continuar con el pedido <ArrowIcon /></button><p>Las opciones de entrega y pago se muestran al finalizar el pedido.</p></div>
          </> : <div className="empty-cart"><div className="empty-bag"><BagIcon /></div><strong>Tu carrito está esperando.</strong><span>Sumá productos que te interesen y aparecerán acá.</span><button className="primary-button" onClick={() => setCartOpen(false)}>Seguir explorando <ArrowIcon /></button></div>}
        </aside>
      </div>}

      {checkoutOpen && <CheckoutPage cart={cart} subtotal={cartTotal} onBack={() => { setCheckoutOpen(false); setCartOpen(true) }} onFinish={() => { setCheckoutOpen(false); setCartOpen(false) }} onOrderCreated={() => { setCart([]); void fetchProducts().then(setProducts).catch(() => undefined) }} />}

      {selected && <div className="product-page-overlay">
        <section className="product-page">
          <button className="product-back-link" onClick={closeProduct}>← Volver al catálogo</button>
          <div className="product-page-grid">
            <div className="product-page-image">{selected.image ? <img src={selected.image} alt={selected.name} /> : <div className="product-image-placeholder">Imagen no disponible</div>}</div>
            <div className="product-page-copy">
              <span className="product-category">{selected.category}</span>
              <h1>{selected.name}</h1>
              <strong className="product-page-price">{formatPrice(selected.price)}</strong>
              <p>{selected.description}</p>
              <div className={selected.stock > 0 ? 'product-availability available' : 'product-availability unavailable'}>
                {selected.stock > 0 ? `Disponible · ${selected.stock} unidades en stock` : 'Producto sin stock'}
              </div>
              {selected.specs.length > 0 && <><h2>Características</h2><ul>{selected.specs.map((spec) => <li key={spec}>{spec}</li>)}</ul></>}
              <button className="primary-button product-page-add" disabled={selected.stock <= 0} onClick={() => addToCart(selected)}>{selected.stock > 0 ? 'Agregar al carrito' : 'Sin stock'} <ArrowIcon /></button>
              <small>El envío se calculará en una próxima etapa. Los pagos todavía no están habilitados.</small>
            </div>
          </div>
        </section>
      </div>}
    </div>
  )
}