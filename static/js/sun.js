// Posição do sol para o terminador dia/noite. Módulo puro (sem DOM): também roda nos testes
// do Node. Fórmulas de baixa precisão do Astronomical Almanac (erro bem abaixo de 1°,
// muito menos do que a faixa de crepúsculo que o shader desenha).

const DAY = 86400 * 1000;
const J2000 = Date.UTC(2000, 0, 1, 12);  // época J2000.0 (meio-dia UTC de 1/1/2000)
const RAD = Math.PI / 180;

// Ponto subsolar (onde o sol está a pino) num instante UTC, em graus
export function subsolarPoint(ms) {
    const d = (ms - J2000) / DAY;
    const g = (357.529 + 0.98560028 * d) * RAD;            // anomalia média
    const q = 280.459 + 0.98564736 * d;                    // longitude média
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;  // longitude eclíptica
    const e = (23.439 - 0.00000036 * d) * RAD;             // obliquidade da eclíptica

    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;  // ascensão reta
    const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;              // declinação
    const gmst = 280.46061837 + 360.98564736629 * d;      // tempo sideral de Greenwich (graus)

    const lng = ((((ra - gmst) % 360) + 540) % 360) - 180;
    return { lat: dec, lng };
}

// Vetor unitário apontando para o sol no mesmo referencial do shader:
// x para (0°, 0°), y para (0°, 90° L), z para o polo norte
export function sunDirection(ms) {
    const { lat, lng } = subsolarPoint(ms);
    const cl = Math.cos(lat * RAD);
    return [cl * Math.cos(lng * RAD), cl * Math.sin(lng * RAD), Math.sin(lat * RAD)];
}
