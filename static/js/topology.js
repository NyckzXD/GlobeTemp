// Leitura mínima de TopoJSON (formato do world-atlas). Módulo puro: também roda nos testes do Node.

// Arcos em [lng, lat]; com `transform`, as posições vêm quantizadas e em delta
export function decodeArcs(topology) {
    const { arcs, transform } = topology;
    if (!transform) return arcs;
    const [sx, sy] = transform.scale;
    const [tx, ty] = transform.translate;
    return arcs.map((arc) => {
        let x = 0, y = 0;
        return arc.map(([dx, dy]) => {
            x += dx;
            y += dy;
            return [x * sx + tx, y * sy + ty];
        });
    });
}

// Índices dos arcos de uma geometria (Polygon/MultiPolygon/GeometryCollection), achatados.
// Um índice negativo i quer dizer o arco ~i percorrido ao contrário.
function arcIndices(geometry, out = []) {
    switch (geometry.type) {
        case 'GeometryCollection': geometry.geometries.forEach((g) => arcIndices(g, out)); break;
        case 'Polygon': geometry.arcs.flat().forEach((i) => out.push(i)); break;
        case 'MultiPolygon': geometry.arcs.flat(2).forEach((i) => out.push(i)); break;
        default: break;
    }
    return out;
}

// Separa os arcos de um objeto de polígonos (ex.: países): arco usado por um só polígono é
// linha de costa; arco compartilhado por dois é fronteira.
export function topologyLines(topology, objectName) {
    const lines = decodeArcs(topology);
    const uses = new Uint8Array(lines.length);
    for (const i of arcIndices(topology.objects[objectName])) {
        const k = i < 0 ? ~i : i;
        uses[k] = Math.min(255, uses[k] + 1);
    }
    const coasts = [], borders = [];
    lines.forEach((line, k) => {
        if (uses[k] === 1) coasts.push(line);
        else if (uses[k] > 1) borders.push(line);
    });
    return { coasts, borders };
}
