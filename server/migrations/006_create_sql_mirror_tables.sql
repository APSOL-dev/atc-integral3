-- Migración 006: Creación de tablas espejo 100% aisladas para réplica de SQL Server y Cola Buffer
-- NOTA IMPORTANTE: Esta migración NO modifica ni altera las tablas existentes (usuarios, pedidos, detalles_pedidos).

CREATE SCHEMA IF NOT EXISTS "atc_migración";

-- ============================================================================
-- 1. TABLA ESPEJO: CLIENTES (Réplica de App.ClientesMay)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "atc_migración".sql_clientes (
    nro_cliente INT PRIMARY KEY,
    nombre_cliente TEXT,
    cuit TEXT,
    saldo NUMERIC(15,2) DEFAULT 0,
    vendedor TEXT,
    nro_vendedor INT,
    localidad TEXT,
    provincia TEXT,
    telefono TEXT,
    suc INT,
    direc TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE VIEW public.atc_sql_clientes_v AS
SELECT 
    nro_cliente AS "NRO_CLIENTE",
    nombre_cliente AS "NOMBRE_CLIENTE",
    cuit AS "CUIT",
    saldo AS "SALDO",
    vendedor AS "VENDEDOR",
    nro_vendedor AS "NRO_VENDEDOR",
    localidad AS "LOCALIDAD",
    provincia AS "PROVINCIA",
    telefono AS "TELE",
    suc AS "SUC",
    direc AS "DIREC",
    synced_at AS "synced_at"
FROM "atc_migración".sql_clientes;

CREATE OR REPLACE FUNCTION public.atc_sql_clientes_v_instead_of_func()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        INSERT INTO "atc_migración".sql_clientes (
            nro_cliente, nombre_cliente, cuit, saldo, vendedor, nro_vendedor, localidad, provincia, telefono, suc, direc, synced_at
        ) VALUES (
            NEW."NRO_CLIENTE", NEW."NOMBRE_CLIENTE", NEW."CUIT", COALESCE(NEW."SALDO"::numeric, 0),
            NEW."VENDEDOR", NEW."NRO_VENDEDOR"::int, NEW."LOCALIDAD", NEW."PROVINCIA",
            NEW."TELE", NEW."SUC"::int, NEW."DIREC", NOW()
        )
        ON CONFLICT (nro_cliente) DO UPDATE SET
            nombre_cliente = EXCLUDED.nombre_cliente,
            cuit = EXCLUDED.cuit,
            saldo = EXCLUDED.saldo,
            vendedor = EXCLUDED.vendedor,
            nro_vendedor = EXCLUDED.nro_vendedor,
            localidad = EXCLUDED.localidad,
            provincia = EXCLUDED.provincia,
            telefono = EXCLUDED.telefono,
            suc = EXCLUDED.suc,
            direc = EXCLUDED.direc,
            synced_at = NOW();
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        DELETE FROM "atc_migración".sql_clientes WHERE nro_cliente = OLD."NRO_CLIENTE";
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_atc_sql_clientes_v ON public.atc_sql_clientes_v;
CREATE TRIGGER trg_atc_sql_clientes_v
INSTEAD OF INSERT OR UPDATE OR DELETE ON public.atc_sql_clientes_v
FOR EACH ROW EXECUTE FUNCTION public.atc_sql_clientes_v_instead_of_func();

-- ============================================================================
-- 2. TABLA ESPEJO: PRODUCTOS (Réplica de App.Productos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "atc_migración".sql_productos (
    codart INT PRIMARY KEY,
    descri TEXT,
    cc_civa NUMERIC(15,2) DEFAULT 0,
    stock NUMERIC(12,4) DEFAULT 0,
    familia INT,
    nombre_familia TEXT,
    rubro INT,
    nombre_rubro TEXT,
    marca INT,
    nombre_marca TEXT,
    embalaje TEXT,
    proveedor TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE VIEW public.atc_sql_productos_v AS
SELECT 
    codart AS "CODART",
    descri AS "DESCRI",
    cc_civa AS "CC_CIVA",
    stock AS "stock",
    familia AS "FAMILIA",
    nombre_familia AS "NombreFamilia",
    rubro AS "RUBRO",
    nombre_rubro AS "NombreRubro",
    marca AS "MARCA",
    nombre_marca AS "NombreMarca",
    embalaje AS "Embalaje",
    proveedor AS "Proveedor",
    synced_at AS "synced_at"
FROM "atc_migración".sql_productos;

CREATE OR REPLACE FUNCTION public.atc_sql_productos_v_instead_of_func()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        INSERT INTO "atc_migración".sql_productos (
            codart, descri, cc_civa, stock, familia, nombre_familia, rubro, nombre_rubro, marca, nombre_marca, embalaje, proveedor, synced_at
        ) VALUES (
            NEW."CODART", NEW."DESCRI", COALESCE(NEW."CC_CIVA"::numeric, 0), COALESCE(NEW."stock"::numeric, 0),
            NEW."FAMILIA"::int, NEW."NombreFamilia", NEW."RUBRO"::int, NEW."NombreRubro",
            NEW."MARCA"::int, NEW."NombreMarca", NEW."Embalaje", NEW."Proveedor", NOW()
        )
        ON CONFLICT (codart) DO UPDATE SET
            descri = EXCLUDED.descri,
            cc_civa = EXCLUDED.cc_civa,
            stock = EXCLUDED.stock,
            familia = EXCLUDED.familia,
            nombre_familia = EXCLUDED.nombre_familia,
            rubro = EXCLUDED.rubro,
            nombre_rubro = EXCLUDED.nombre_rubro,
            marca = EXCLUDED.marca,
            nombre_marca = EXCLUDED.nombre_marca,
            embalaje = EXCLUDED.embalaje,
            proveedor = EXCLUDED.proveedor,
            synced_at = NOW();
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        DELETE FROM "atc_migración".sql_productos WHERE codart = OLD."CODART";
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_atc_sql_productos_v ON public.atc_sql_productos_v;
CREATE TRIGGER trg_atc_sql_productos_v
INSTEAD OF INSERT OR UPDATE OR DELETE ON public.atc_sql_productos_v
FOR EACH ROW EXECUTE FUNCTION public.atc_sql_productos_v_instead_of_func();

-- ============================================================================
-- 3. TABLA ESPEJO: VENDEDORES (Réplica de App.Vendedores)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "atc_migración".sql_vendedores (
    nro_vendedor INT PRIMARY KEY,
    nombre TEXT,
    alias TEXT,
    vdor INT,
    activo INT DEFAULT 1,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE VIEW public.atc_sql_vendedores_v AS
SELECT 
    nro_vendedor AS "NRO_VENDEDOR",
    nombre AS "NOMBRE",
    alias AS "ALIAS",
    vdor AS "VDOR",
    activo AS "ACTIVO",
    synced_at AS "synced_at"
FROM "atc_migración".sql_vendedores;

CREATE OR REPLACE FUNCTION public.atc_sql_vendedores_v_instead_of_func()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        INSERT INTO "atc_migración".sql_vendedores (
            nro_vendedor, nombre, alias, vdor, activo, synced_at
        ) VALUES (
            NEW."NRO_VENDEDOR", NEW."NOMBRE", NEW."ALIAS", NEW."VDOR"::int, COALESCE(NEW."ACTIVO"::int, 1), NOW()
        )
        ON CONFLICT (nro_vendedor) DO UPDATE SET
            nombre = EXCLUDED.nombre,
            alias = EXCLUDED.alias,
            vdor = EXCLUDED.vdor,
            activo = EXCLUDED.activo,
            synced_at = NOW();
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        DELETE FROM "atc_migración".sql_vendedores WHERE nro_vendedor = OLD."NRO_VENDEDOR";
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_atc_sql_vendedores_v ON public.atc_sql_vendedores_v;
CREATE TRIGGER trg_atc_sql_vendedores_v
INSTEAD OF INSERT OR UPDATE OR DELETE ON public.atc_sql_vendedores_v
FOR EACH ROW EXECUTE FUNCTION public.atc_sql_vendedores_v_instead_of_func();

-- ============================================================================
-- 4. TABLA ESPEJO: PEDIDOS CABECERA (Réplica de AppTransacciones.PedidoAppCabe)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "atc_migración".sql_pedidos_cabe (
    id_pedido INT PRIMARY KEY,
    cliente TEXT,
    fecha_hora TIMESTAMPTZ,
    direccion TEXT,
    creado_por TEXT,
    observaciones TEXT,
    fecha_ultima_modificacion TIMESTAMPTZ,
    estado TEXT DEFAULT '1',
    vendedor TEXT,
    nro_pedidogestion TEXT,
    nro_pedidoreferencia TEXT,
    estado_enviado INT DEFAULT 0,
    total NUMERIC(15,2) DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE VIEW public.atc_sql_pedidos_cabe_v AS
SELECT 
    id_pedido AS "IDPedido",
    cliente AS "Cliente",
    fecha_hora AS "Fecha_Hora",
    direccion AS "Direccion",
    creado_por AS "Creado_Por",
    observaciones AS "Observaciones",
    fecha_ultima_modificacion AS "Fecha_Ultima_Modificacion",
    estado AS "Estado",
    vendedor AS "Vendedor",
    nro_pedidogestion AS "Nro_PedidoGestion",
    nro_pedidoreferencia AS "Nro_PedidoReferencia",
    estado_enviado AS "EstadoEnviado",
    total AS "Total",
    synced_at AS "synced_at"
FROM "atc_migración".sql_pedidos_cabe;

CREATE OR REPLACE FUNCTION public.atc_sql_pedidos_cabe_v_instead_of_func()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        INSERT INTO "atc_migración".sql_pedidos_cabe (
            id_pedido, cliente, fecha_hora, direccion, creado_por, observaciones,
            fecha_ultima_modificacion, estado, vendedor, nro_pedidogestion, nro_pedidoreferencia, estado_enviado, total, synced_at
        ) VALUES (
            NEW."IDPedido", NEW."Cliente", NEW."Fecha_Hora"::timestamptz, NEW."Direccion", NEW."Creado_Por", NEW."Observaciones",
            COALESCE(NEW."Fecha_Ultima_Modificacion"::timestamptz, NOW()), COALESCE(NEW."Estado", '1'), NEW."Vendedor",
            NEW."Nro_PedidoGestion", NEW."Nro_PedidoReferencia", COALESCE(NEW."EstadoEnviado"::int, 0), COALESCE(NEW."Total"::numeric, 0), NOW()
        )
        ON CONFLICT (id_pedido) DO UPDATE SET
            cliente = EXCLUDED.cliente,
            fecha_hora = EXCLUDED.fecha_hora,
            direccion = EXCLUDED.direccion,
            creado_por = EXCLUDED.creado_por,
            observaciones = EXCLUDED.observaciones,
            fecha_ultima_modificacion = EXCLUDED.fecha_ultima_modificacion,
            estado = EXCLUDED.estado,
            vendedor = EXCLUDED.vendedor,
            nro_pedidogestion = EXCLUDED.nro_pedidogestion,
            nro_pedidoreferencia = EXCLUDED.nro_pedidoreferencia,
            estado_enviado = EXCLUDED.estado_enviado,
            total = EXCLUDED.total,
            synced_at = NOW();
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        DELETE FROM "atc_migración".sql_pedidos_cabe WHERE id_pedido = OLD."IDPedido";
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_atc_sql_pedidos_cabe_v ON public.atc_sql_pedidos_cabe_v;
CREATE TRIGGER trg_atc_sql_pedidos_cabe_v
INSTEAD OF INSERT OR UPDATE OR DELETE ON public.atc_sql_pedidos_cabe_v
FOR EACH ROW EXECUTE FUNCTION public.atc_sql_pedidos_cabe_v_instead_of_func();

-- ============================================================================
-- 5. TABLA ESPEJO: PEDIDOS DETALLE (Réplica de AppTransacciones.PedidoAppDeta)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "atc_migración".sql_pedidos_deta (
    id_detalle TEXT PRIMARY KEY,
    id_pedido INT,
    item_codigo TEXT,
    nombre_item TEXT,
    cantidad NUMERIC(12,4) DEFAULT 0,
    descuento NUMERIC(15,2) DEFAULT 0,
    porcent NUMERIC(5,2) DEFAULT 0,
    precio NUMERIC(15,2) DEFAULT 0,
    sub_total NUMERIC(15,2) DEFAULT 0,
    total NUMERIC(15,2) DEFAULT 0,
    cantidad_preparada NUMERIC(12,4) DEFAULT 0,
    id_renglon_gestion TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sql_pedidos_deta_id_pedido ON "atc_migración".sql_pedidos_deta(id_pedido);

CREATE OR REPLACE VIEW public.atc_sql_pedidos_deta_v AS
SELECT 
    id_detalle AS "IdDetalle",
    id_pedido AS "IdPedido",
    item_codigo AS "ItemCodigo",
    nombre_item AS "NombreItem",
    cantidad AS "Cantidad",
    descuento AS "Descuento",
    porcent AS "PORCENT",
    precio AS "Precio",
    sub_total AS "Sub_Total",
    total AS "Total",
    cantidad_preparada AS "CantidadPreparada",
    id_renglon_gestion AS "IdRenglonGestion",
    synced_at AS "synced_at"
FROM "atc_migración".sql_pedidos_deta;

CREATE OR REPLACE FUNCTION public.atc_sql_pedidos_deta_v_instead_of_func()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        INSERT INTO "atc_migración".sql_pedidos_deta (
            id_detalle, id_pedido, item_codigo, nombre_item, cantidad, descuento, porcent, precio, sub_total, total, cantidad_preparada, id_renglon_gestion, synced_at
        ) VALUES (
            NEW."IdDetalle", NEW."IdPedido"::int, NEW."ItemCodigo", NEW."NombreItem",
            COALESCE(NEW."Cantidad"::numeric, 0), COALESCE(NEW."Descuento"::numeric, 0), COALESCE(NEW."PORCENT"::numeric, 0),
            COALESCE(NEW."Precio"::numeric, 0), COALESCE(NEW."Sub_Total"::numeric, 0), COALESCE(NEW."Total"::numeric, 0),
            COALESCE(NEW."CantidadPreparada"::numeric, 0), NEW."IdRenglonGestion", NOW()
        )
        ON CONFLICT (id_detalle) DO UPDATE SET
            id_pedido = EXCLUDED.id_pedido,
            item_codigo = EXCLUDED.item_codigo,
            nombre_item = EXCLUDED.nombre_item,
            cantidad = EXCLUDED.cantidad,
            descuento = EXCLUDED.descuento,
            porcent = EXCLUDED.porcent,
            precio = EXCLUDED.precio,
            sub_total = EXCLUDED.sub_total,
            total = EXCLUDED.total,
            cantidad_preparada = EXCLUDED.cantidad_preparada,
            id_renglon_gestion = EXCLUDED.id_renglon_gestion,
            synced_at = NOW();
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        DELETE FROM "atc_migración".sql_pedidos_deta WHERE id_detalle = OLD."IdDetalle";
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_atc_sql_pedidos_deta_v ON public.atc_sql_pedidos_deta_v;
CREATE TRIGGER trg_atc_sql_pedidos_deta_v
INSTEAD OF INSERT OR UPDATE OR DELETE ON public.atc_sql_pedidos_deta_v
FOR EACH ROW EXECUTE FUNCTION public.atc_sql_pedidos_deta_v_instead_of_func();

-- ============================================================================
-- 6. TABLA AISLADA: COLA BUFFER SALIENTE (Supabase ➔ SQL Server)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "atc_migración".sync_cola_pedidos (
    id BIGSERIAL PRIMARY KEY,
    id_pedido INT NOT NULL,
    accion TEXT NOT NULL DEFAULT 'INSERT_OR_UPDATE', -- 'INSERT_OR_UPDATE', 'UPDATE_ESTADO', 'DELETE'
    nuevo_estado TEXT,
    payload_pedido JSONB,
    payload_detalles JSONB,
    status TEXT NOT NULL DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'PROCESANDO', 'SINCRONIZADO', 'ERROR'
    intentos INT NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_cola_status ON "atc_migración".sync_cola_pedidos(status);

CREATE OR REPLACE VIEW public.atc_sync_cola_pedidos_v AS
SELECT * FROM "atc_migración".sync_cola_pedidos;
