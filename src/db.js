import Dexie from 'dexie';

export const db = new Dexie('CatalogoMEF');

// Definimos el esquema de la base de datos
// Indexamos campos por los que buscaremos y filtraremos
// Agregamos índices para NOMBRE_GRUPO, CLASE y FAMILIA para poblar los filtros rápidamente
db.version(2).stores({
    catalogo: '++id, TIPO_BIEN, NOMBRE_ITEM, NOMBRE_GRUPO, NOMBRE_CLASE, NOMBRE_FAMILIA, GRUPO_BIEN, CLASE_BIEN, FAMILIA_BIEN, ITEM_BIEN'
});

export default db;
