const fs = require('fs');
const path = require('path');

function parseNum(val) {
  if (!val || val === '-' || val === '#DIV/0!' || val.trim() === '') return 0;
  const clean = val.replace(/"/g, '').replace(',', '.').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function parseCsv(filepath, year) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  
  const months = [];
  let totals = null;

  for (let i = 0; i < lines.length; i++) {
    const cols = [];
    let inQuotes = false;
    let cur = '';
    const line = lines[i];

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());

    const monthName = cols[0];
    if (['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'].includes(monthName)) {
      const kmTot = parseNum(cols[1]);
      const kmAlex = parseNum(cols[2]);
      const kmCinzia = parseNum(cols[3]);
      const kwhTot = parseNum(cols[4]);
      const kwhAlex = parseNum(cols[5]);
      const kwhCinzia = parseNum(cols[6]);
      const mediaKwh100km = parseNum(cols[7]);
      const wbKwh = parseNum(cols[8]);
      const colKwh = parseNum(cols[9]);
      const ricaricaKwhTot = parseNum(cols[10]);
      const wbEur = parseNum(cols[11]);
      const colEur = parseNum(cols[12]);
      const spesaTotEur = parseNum(cols[13]);
      const wbEurKwh = parseNum(cols[14]);
      const colEurKwh = parseNum(cols[15]);
      const mediaEurKwh = parseNum(cols[16]);

      // Risparmio cumulativo veicoli
      const risparmioPeugeotEur = parseNum(cols[20]);
      const risparmioPeugeotPct = parseNum(cols[21]);
      const risparmioFiatEur = parseNum(cols[27]);
      const risparmioFiatPct = parseNum(cols[28]);

      // Alex e Cinzia
      let alexSavingsEur = 0;
      let alexCo2Kg = 0;
      let cinziaSavingsEur = 0;
      let cinziaCo2Kg = 0;

      if (year === 2024) {
        alexSavingsEur = parseNum(cols[36]);
        alexCo2Kg = parseNum(cols[38]);
        cinziaSavingsEur = parseNum(cols[43]);
        cinziaCo2Kg = parseNum(cols[45]);
      } else {
        alexSavingsEur = parseNum(cols[37]);
        alexCo2Kg = parseNum(cols[39]);
        cinziaSavingsEur = parseNum(cols[44]);
        cinziaCo2Kg = parseNum(cols[46]);
      }

      if (kmTot > 0 || kwhTot > 0 || ricaricaKwhTot > 0) {
        months.push({
          month: monthName,
          year,
          label: `${monthName} ${year}`,
          km: { total: kmTot, alex: kmAlex, cinzia: kmCinzia },
          consumption: { kwhTotal: kwhTot, alexKwh: kwhAlex, cinziaKwh: kwhCinzia, kwhPer100km: mediaKwh100km },
          charging: {
            wallboxKwh: wbKwh,
            publicKwh: colKwh,
            totalKwh: ricaricaKwhTot,
            wallboxEur: wbEur,
            publicEur: colEur,
            totalEur: spesaTotEur,
            costPerKwhWb: wbEurKwh,
            costPerKwhPublic: colEurKwh,
            costPerKwhAvg: mediaEurKwh
          },
          savings: {
            vsPeugeotDieselEur: risparmioPeugeotEur,
            vsFiatBenzinaEur: risparmioFiatEur,
            totalSavingsEur: +(alexSavingsEur + cinziaSavingsEur || risparmioPeugeotEur).toFixed(2),
            alexSavingsEur,
            cinziaSavingsEur,
            alexCo2Kg,
            cinziaCo2Kg,
            totalCo2SavedKg: +(alexCo2Kg + cinziaCo2Kg).toFixed(2)
          }
        });
      }
    } else if (monthName === 'Totale') {
      let alexSavingsEur = 0;
      let alexCo2Kg = 0;
      let cinziaSavingsEur = 0;
      let cinziaCo2Kg = 0;

      if (year === 2024) {
        alexSavingsEur = parseNum(cols[36]);
        alexCo2Kg = parseNum(cols[38]);
        cinziaSavingsEur = parseNum(cols[43]);
        cinziaCo2Kg = parseNum(cols[45]);
      } else {
        alexSavingsEur = parseNum(cols[37]);
        alexCo2Kg = parseNum(cols[39]);
        cinziaSavingsEur = parseNum(cols[44]);
        cinziaCo2Kg = parseNum(cols[46]);
      }

      totals = {
        year,
        kmTotal: parseNum(cols[1]),
        kmAlex: parseNum(cols[2]),
        kmCinzia: parseNum(cols[3]),
        kwhTotal: parseNum(cols[4]),
        wallboxKwh: parseNum(cols[8]),
        publicKwh: parseNum(cols[9]),
        totalChargedKwh: parseNum(cols[10]),
        wallboxEur: parseNum(cols[11]),
        publicEur: parseNum(cols[12]),
        totalChargedEur: parseNum(cols[13]),
        savingsPeugeotDieselEur: parseNum(cols[20]),
        savingsFiatBenzinaEur: parseNum(cols[27]),
        alexSavingsEur,
        alexCo2Kg,
        cinziaSavingsEur,
        cinziaCo2Kg,
        totalCo2SavedKg: +(alexCo2Kg + cinziaCo2Kg).toFixed(2)
      };
    }
  }

  return { months, totals };
}

function run() {
  const dataDir = path.resolve(__dirname, '../data');
  const file2024 = path.join(dataDir, 'volvo-consumi-2024.csv');
  const file2025 = path.join(dataDir, 'volvo-consumi-2025.csv');
  const file2026 = path.join(dataDir, 'volvo-consumi-2026.csv');

  const y2024 = parseCsv(file2024, 2024);
  const y2025 = parseCsv(file2025, 2025);
  const y2026 = parseCsv(file2026, 2026);

  const allMonths = [...y2024.months, ...y2025.months, ...y2026.months];

  // Cumulative sums
  const cumulative = {
    totalKm: 0,
    alexKm: 0,
    cinziaKm: 0,
    wallboxKwh: 0,
    publicKwh: 0,
    totalChargedKwh: 0,
    wallboxEur: 0,
    publicEur: 0,
    totalCostEur: 0,
    totalSavingsEur: 0,
    totalCo2Kg: 0,
    avgWallboxEurKwh: 0,
    monthsTracked: allMonths.length
  };

  allMonths.forEach(m => {
    cumulative.totalKm += m.km.total;
    cumulative.alexKm += m.km.alex;
    cumulative.cinziaKm += m.km.cinzia;
    cumulative.wallboxKwh += m.charging.wallboxKwh;
    cumulative.publicKwh += m.charging.publicKwh;
    cumulative.totalChargedKwh += m.charging.totalKwh;
    cumulative.wallboxEur += m.charging.wallboxEur;
    cumulative.publicEur += m.charging.publicEur;
    cumulative.totalCostEur += m.charging.totalEur;
    cumulative.totalSavingsEur += m.savings.totalSavingsEur;
    cumulative.totalCo2Kg += m.savings.totalCo2SavedKg;
  });

  cumulative.totalKm = Math.round(cumulative.totalKm);
  cumulative.alexKm = Math.round(cumulative.alexKm);
  cumulative.cinziaKm = Math.round(cumulative.cinziaKm);
  cumulative.wallboxKwh = +cumulative.wallboxKwh.toFixed(1);
  cumulative.publicKwh = +cumulative.publicKwh.toFixed(1);
  cumulative.totalChargedKwh = +cumulative.totalChargedKwh.toFixed(1);
  cumulative.wallboxEur = +cumulative.wallboxEur.toFixed(2);
  cumulative.publicEur = +cumulative.publicEur.toFixed(2);
  cumulative.totalCostEur = +cumulative.totalCostEur.toFixed(2);
  cumulative.totalSavingsEur = +cumulative.totalSavingsEur.toFixed(2);
  cumulative.totalCo2Kg = +cumulative.totalCo2Kg.toFixed(1);
  cumulative.avgWallboxEurKwh = +(cumulative.wallboxEur / (cumulative.wallboxKwh || 1)).toFixed(4);

  const analytics = {
    generatedAt: new Date().toISOString(),
    providerDolomiti: {
      electricity: {
        provider: 'Dolomiti Energia',
        offer: 'Mitica Energia 36 Bioraria Web',
        tariffExpiry: '31/08/2028',
        pod: process.env.UTILITY_POD || 'IT001E********',
        committedPowerKw: 6.0,
        averageCostEurPerKwh: 0.215,
        f1CostEurPerKwh: 0.110,
        f23CostEurPerKwh: 0.083
      },
      gas: {
        provider: 'Dolomiti Energia',
        offer: 'Mitica Gas 24 Web',
        tariffExpiry: '31/08/2027',
        pdr: process.env.UTILITY_PDR || '0088**********',
        rawGasCostEurPerSmc: 0.3848,
        finishedCostEurPerSmc: 0.87
      }
    },
    cumulative,
    years: {
      2024: y2024,
      2025: y2025,
      2026: y2026
    },
    timeline: allMonths
  };

  const outFile = path.join(dataDir, 'historical-energy-analytics.json');
  fs.writeFileSync(outFile, JSON.stringify(analytics, null, 2), 'utf8');
  console.log(`Saved historical analytics to ${outFile}`);
  console.log(`Months tracked: ${analytics.timeline.length}`);
  console.log(`Total Km: ${cumulative.totalKm} (Alex: ${cumulative.alexKm}, Cinzia: ${cumulative.cinziaKm})`);
  console.log(`Total Charged: ${cumulative.totalChargedKwh} kWh (${cumulative.wallboxKwh} kWh Wallbox, ${cumulative.publicKwh} kWh Colonnine)`);
  console.log(`Total Spesa Ricarica: ${cumulative.totalCostEur} €`);
  console.log(`Total Risparmio Carburante: ${cumulative.totalSavingsEur} €`);
  console.log(`CO2 Evitata: ${cumulative.totalCo2Kg} kg (${(cumulative.totalCo2Kg/1000).toFixed(2)} tonnellate)`);
}

run();
