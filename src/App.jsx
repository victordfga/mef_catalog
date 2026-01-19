import { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { Search, Loader2, AlertCircle, X, Info, Filter, ChevronRight, ChevronLeft, LayoutGrid, List } from 'lucide-react';
import { db } from './db';
import './App.css';

function App() {
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState('checking');
  const [syncProgress, setSyncProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('TODOS');

  // Filtros avanzados
  const [filtros, setFiltros] = useState({ grupo: '', clase: '', familia: '' });
  const [opcionesFiltros, setOpcionesFiltros] = useState({ grupos: [], clases: [], familias: [] });

  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const ITEMS_PER_PAGE = 24;

  // Verificar si la Base de Datos está poblada
  useEffect(() => {
    const checkDB = async () => {
      try {
        const count = await db.catalogo.count();
        if (count > 0) {
          setSyncStatus('ready');
          await cargarOpcionesFiltros();
          setLoading(false);
          buscarEnBD();
        } else {
          iniciarSincronizacion();
        }
      } catch (error) {
        console.error('Error al verificar BD:', error);
        setSyncStatus('error');
        setLoading(false);
      }
    };
    checkDB();
  }, []);

  // Cargar opciones únicas para los combos
  // Nota: En 600k registros, esto puede ser costoso si no se hace bien.
  // Usaremos Dexie para extraer los valores únicos de los índices.
  const cargarOpcionesFiltros = async () => {
    const grupos = await db.catalogo.orderBy('NOMBRE_GRUPO').uniqueKeys();
    setOpcionesFiltros(prev => ({ ...prev, grupos }));
  };

  // Actualizar clases cuando cambia el grupo
  useEffect(() => {
    const cargarClases = async () => {
      if (filtros.grupo) {
        const clasesSet = new Set();
        // Usamos each para evitar cargar miles de objetos pesados en un array
        await db.catalogo
          .where('NOMBRE_GRUPO').equals(filtros.grupo)
          .each(item => clasesSet.add(item.NOMBRE_CLASE));

        setOpcionesFiltros(prev => ({ ...prev, clases: Array.from(clasesSet).sort() }));
      } else {
        setOpcionesFiltros(prev => ({ ...prev, clases: [], familias: [] }));
      }
    };
    cargarClases();
  }, [filtros.grupo]);

  // Actualizar familias cuando cambia la clase
  useEffect(() => {
    const cargarFamilias = async () => {
      if (filtros.clase && filtros.grupo) {
        const familiasSet = new Set();
        await db.catalogo
          .where('NOMBRE_GRUPO').equals(filtros.grupo)
          .filter(i => i.NOMBRE_CLASE === filtros.clase)
          .each(item => familiasSet.add(item.NOMBRE_FAMILIA));

        setOpcionesFiltros(prev => ({ ...prev, familias: Array.from(familiasSet).sort() }));
      } else {
        setOpcionesFiltros(prev => ({ ...prev, familias: [] }));
      }
    };
    cargarFamilias();
  }, [filtros.clase, filtros.grupo]);

  const iniciarSincronizacion = () => {
    setSyncStatus('syncing');
    setLoading(true);
    let count = 0;

    Papa.parse('Catalogo-SIGA_MEF.csv', {
      download: true,
      header: true,
      skipEmptyLines: true,
      chunk: async (results, parser) => {
        parser.pause();
        try {
          await db.catalogo.bulkAdd(results.data);
          count += results.data.length;
          setSyncProgress(count);
          parser.resume();
        } catch (error) {
          console.error('Error en bulkAdd:', error);
          parser.abort();
          setSyncStatus('error');
        }
      },
      complete: async () => {
        await cargarOpcionesFiltros();
        setSyncStatus('ready');
        setLoading(false);
        buscarEnBD();
      },
      error: (error) => {
        console.error('Error al sincronizar:', error);
        setSyncStatus('error');
        setLoading(false);
      }
    });
  };

  // Manejar Búsqueda con todos los filtros
  useEffect(() => {
    const timer = setTimeout(() => {
      buscarEnBD();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, tipoFiltro, filtros, page]);

  const buscarEnBD = async () => {
    if (syncStatus !== 'ready') return;

    let collection;
    const termino = searchTerm.trim().toLowerCase();

    // 1. Prioridad: Filtros Indexados (Dexie.where)
    // Buscamos el filtro más restrictivo para empezar la colección
    if (filtros.grupo) {
      collection = db.catalogo.where('NOMBRE_GRUPO').equals(filtros.grupo);
    } else if (tipoFiltro !== 'TODOS') {
      collection = db.catalogo.where('TIPO_BIEN').equals(tipoFiltro);
    } else {
      collection = db.catalogo.toCollection();
    }

    // 2. Aplicar filtros adicionales sobre la colección
    collection = collection.filter(item => {
      let matchTipo = true;
      if (tipoFiltro !== 'TODOS') {
        if (tipoFiltro === 'O') {
          matchTipo = item.NOMBRE_UNIDAD_MEDIDA === 'OBRA';
        } else if (tipoFiltro === 'S') {
          matchTipo = item.TIPO_BIEN === 'S' && item.NOMBRE_UNIDAD_MEDIDA !== 'OBRA';
        } else {
          matchTipo = item.TIPO_BIEN === tipoFiltro;
        }
      }

      const matchClase = !filtros.clase || item.NOMBRE_CLASE === filtros.clase;
      const matchFamilia = !filtros.familia || item.NOMBRE_FAMILIA === filtros.familia;

      let matchTexto = true;
      if (termino) {
        const codigoSiga = `${item.GRUPO_BIEN}${item.CLASE_BIEN}${item.FAMILIA_BIEN}${item.ITEM_BIEN}`;
        matchTexto = (item.NOMBRE_ITEM?.toLowerCase().includes(termino) || codigoSiga.includes(termino));
      }

      return matchTipo && matchClase && matchFamilia && matchTexto;
    });

    const data = await collection
      .offset((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE)
      .toArray();

    setResults(data);
  };

  const handleCardClick = (item) => {
    setSelectedItem(item);
  };

  if (syncStatus === 'syncing') {
    return (
      <div className="loading-container full-screen">
        <div className="sync-card">
          <Loader2 className="spinner pc-blue" size={64} />
          <h2>Optimizando Catálogo MEF</h2>
          <p>Estamos procesando los registros para garantizar búsquedas instantáneas en su dispositivo.</p>
          <div className="progress-stats">
            <span className="count-main">{syncProgress.toLocaleString()}</span>
            <span className="count-label">registros indexados</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${selectedItem ? 'modal-open' : ''}`}>
      <header className="main-header">
        <div className="container header-flex">
          <div className="brand">
            <div className="mef-logo">MEF</div>
            <div className="brand-text">
              <h1>Catálogo de Bienes y Servicios</h1>
              <p>SIGA - Consulta de Ítems del Catálogo Único</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container">
        <section className="search-box card">
          <div className="search-header">
            <Filter size={18} className="text-muted" />
            <h2>Criterios de Búsqueda</h2>
          </div>

          <div className="search-grid">
            <div className="form-group span-2">
              <label>Descripción o Código SIGA</label>
              <div className="input-with-icon">
                <Search size={18} className="input-icon" />
                <input
                  type="text"
                  placeholder="Ej: LAPTOP, 230500050001, etc..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Tipo de Recurso</label>
              <div className="btn-group">
                <button
                  className={tipoFiltro === 'TODOS' ? 'active' : ''}
                  onClick={() => { setTipoFiltro('TODOS'); setPage(1); }}
                >Todos</button>
                <button
                  className={tipoFiltro === 'B' ? 'active' : ''}
                  onClick={() => { setTipoFiltro('B'); setPage(1); }}
                >Bienes</button>
                <button
                  className={tipoFiltro === 'S' ? 'active' : ''}
                  onClick={() => { setTipoFiltro('S'); setPage(1); }}
                >Servicios</button>
                <button
                  className={tipoFiltro === 'O' ? 'active' : ''}
                  onClick={() => { setTipoFiltro('O'); setPage(1); }}
                >Obras</button>
              </div>
            </div>

            <div className="form-group">
              <label>Grupo</label>
              <select
                value={filtros.grupo}
                onChange={(e) => { setFiltros({ ...filtros, grupo: e.target.value, clase: '', familia: '' }); setPage(1); }}
              >
                <option value="">-- Todos los Grupos --</option>
                {opcionesFiltros.grupos.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Clase</label>
              <select
                disabled={!filtros.grupo}
                value={filtros.clase}
                onChange={(e) => { setFiltros({ ...filtros, clase: e.target.value, familia: '' }); setPage(1); }}
              >
                <option value="">-- Todas las Clases --</option>
                {opcionesFiltros.clases.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Familia</label>
              <select
                disabled={!filtros.clase}
                value={filtros.familia}
                onChange={(e) => { setFiltros({ ...filtros, familia: e.target.value }); setPage(1); }}
              >
                <option value="">-- Todas las Familias --</option>
                {opcionesFiltros.familias.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="results-wrapper">
          <div className="results-toolbar">
            <span className="results-info">Resultados para la búsqueda</span>
            <div className="view-toggle">
              <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}><LayoutGrid size={18} /></button>
              <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}><List size={18} /></button>
            </div>
          </div>

          <div className={`results-${viewMode}`}>
            {results.map((item) => {
              const codigoSiga = `${item.GRUPO_BIEN}${item.CLASE_BIEN}${item.FAMILIA_BIEN}${item.ITEM_BIEN}`;
              return (
                <article key={item.id} className="item-card clickable" onClick={() => handleCardClick(item)}>
                  <div className="badge-tipo" data-tipo={item.NOMBRE_UNIDAD_MEDIDA === 'OBRA' ? 'O' : item.TIPO_BIEN}>
                    {item.NOMBRE_UNIDAD_MEDIDA === 'OBRA' ? 'OBRA' : (item.TIPO_BIEN === 'B' ? 'BIEN' : 'SERVICIO')}
                  </div>
                  <div className="item-content">
                    <span className="code">{codigoSiga}</span>
                    <h3>{item.NOMBRE_ITEM}</h3>
                    <div className="footer-info">
                      <span className="tag">{item.NOMBRE_UNIDAD_MEDIDA}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {results.length === 0 && (
            <div className="empty-state card">
              <Info size={48} className="text-muted" />
              <p>No se encontraron ítems que coincidan con los criterios seleccionados.</p>
            </div>
          )}

          <nav className="pagination-box">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={20} /> Anterior
            </button>
            <span className="page-indicator">Página {page}</span>
            <button disabled={results.length < ITEMS_PER_PAGE} onClick={() => setPage(p => p + 1)}>
              Siguiente <ChevronRight size={20} />
            </button>
          </nav>
        </section>
      </main>

      {/* DETALLE DEL ITEM (MODAL) */}
      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setSelectedItem(null)}><X size={24} /></button>

            <header className="modal-header-detail">
              <div className="badge-tipo large" data-tipo={selectedItem.NOMBRE_UNIDAD_MEDIDA === 'OBRA' ? 'O' : selectedItem.TIPO_BIEN}>
                {selectedItem.NOMBRE_UNIDAD_MEDIDA === 'OBRA' ? 'OBRA' : (selectedItem.TIPO_BIEN === 'B' ? 'BIEN' : 'SERVICIO')}
              </div>
              <h2>Detalle del Ítem</h2>
            </header>

            <div className="modal-body">
              <div className="detail-hero">
                <h1>{selectedItem.NOMBRE_ITEM}</h1>
                <div className="siga-code-large">
                  <small>Código SIGA:</small>
                  <span>{selectedItem.GRUPO_BIEN}{selectedItem.CLASE_BIEN}{selectedItem.FAMILIA_BIEN}{selectedItem.ITEM_BIEN}</span>
                </div>
              </div>

              <div className="info-grid">
                <div className="info-item">
                  <label>Grupo</label>
                  <p>{selectedItem.NOMBRE_GRUPO} ({selectedItem.GRUPO_BIEN})</p>
                </div>
                <div className="info-item">
                  <label>Clase</label>
                  <p>{selectedItem.NOMBRE_CLASE} ({selectedItem.CLASE_BIEN})</p>
                </div>
                <div className="info-item">
                  <label>Familia</label>
                  <p>{selectedItem.NOMBRE_FAMILIA} ({selectedItem.FAMILIA_BIEN})</p>
                </div>
                <div className="info-item">
                  <label>Ítem</label>
                  <p>{selectedItem.ITEM_BIEN}</p>
                </div>
                <div className="info-item">
                  <label>Unidad de Medida</label>
                  <p>{selectedItem.NOMBRE_UNIDAD_MEDIDA}</p>
                </div>
                <div className="info-item">
                  <label>Estado</label>
                  <p className="status-active">ACTIVO</p>
                </div>
              </div>
            </div>

            <footer className="modal-footer">
              <button className="btn-primary" onClick={() => setSelectedItem(null)}>Cerrar Consulta</button>
            </footer>
          </div>
        </div>
      )}

      <footer className="main-footer">
        <div className="container">
          <p>© 2026 Ministerio de Economía y Finanzas - Consulta Dinámica del Catálogo SIGA</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
