/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 University of California San Diego
 * Author: Jim Robinson
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import {StringUtils} from "../../node_modules/igv-utils/src/index.js";

/**
 * Created by jrobinson on 4/7/16.
 */

const transcriptTypes = new Set(['transcript', 'primary_transcript', 'processed_transcript', 'mRNA', 'mrna']);
const cdsTypes = new Set(['CDS', 'cds']);
const codonTypes = new Set(['start_codon', 'stop_codon']);
const utrTypes = new Set(['5UTR', '3UTR', 'UTR', 'five_prime_UTR', 'three_prime_UTR', "3'-UTR", "5'-UTR"]);
const exonTypes = new Set(['exon', 'coding-exon']);
const intronType = 'intron';
const DEFAULT_NAME_FIELDS = ["name", "alias", "id", "gene", "locus", "gene_name"];   // lowercased, from IGV desktop
const transcriptModelTypes = new Set();
for (let cltn of [transcriptTypes, cdsTypes, codonTypes, utrTypes, exonTypes]) {
    for (let t of cltn) {
        transcriptModelTypes.add(t);
    }
}


class GFFHelper {
    constructor(options) {
        this.format = options.format;
        this.filterTypes = options.filterTypes === undefined ?
            new Set(['chromosome']) :
            new Set(options.filterTypes);
    }

    combineFeatures(features) {
        let combinedFeatures;
        if ("gff3" === this.format) {
            const tmp = this.combineFeaturesById(features);
            combinedFeatures = this.combineFeaturesGFF(tmp);
        } else {
            combinedFeatures = this.combineFeaturesGTF(features);
        }
        combinedFeatures.sort(function (a, b) {
            return a.start - b.start;
        })
        return combinedFeatures;
    }

    combineFeaturesById(features) {
        const combinedFeatures = [];
        const chrIdHash = {};
        for (let f of features) {
            if (f.id === undefined) {
                combinedFeatures.push(f);
            } else {
                let idHash = chrIdHash[f.chr];
                if (!idHash) {
                    idHash = {};
                    chrIdHash[f.chr] = idHash;
                }
                if (idHash.hasOwnProperty(f.id)) {
                    const sf = idHash[f.id];
                    if (sf.hasOwnProperty("exons")) {
                        sf.start = Math.min(sf.start, f.start);
                        sf.end = Math.max(sf.end, f.end);
                        sf.exons.push(f);
                    } else {
                        const cf = {
                            id: f.id,
                            type: f.type,
                            chr: f.chr,
                            strand: f.strand,
                            start: Math.min(f.start, sf.start),
                            end: Math.max(f.end, sf.end),
                            exons: [sf, f]
                        };
                        if (f.parent && f.parent.trim() !== "") {
                            cf.parent = f.parent;
                        }
                        idHash[f.id] = cf;
                    }
                } else {
                    idHash[f.id] = f;
                }
            }
        }
        for (let key of Object.keys(chrIdHash)) {
            const idHash = chrIdHash[key];
            for (let id of Object.keys(idHash)) {
                combinedFeatures.push(idHash[id])
            }
        }
        return combinedFeatures;
    }

    combineFeaturesGTF(features) {

        const transcripts = Object.create(null)
        const combinedFeatures = []
        const consumedFeatures = new Set();
        const filterTypes = this.filterTypes;

        features = features.filter(f => filterTypes === undefined || !filterTypes.has(f.type))

        // 1. Build dictionary of transcripts
        for (let f of features) {
            if (transcriptTypes.has(f.type)) {
                const transcriptId = f.id
                if (undefined !== transcriptId) {
                    const gffTranscript = new GFFTranscript(f);
                    transcripts[transcriptId] = gffTranscript;
                    combinedFeatures.push(gffTranscript);
                    consumedFeatures.add(f)
                }
            }
        }

        // Add exons
        for (let f of features) {
            if (exonTypes.has(f.type)) {
                const id = f.id;   // transcript_id,  GTF groups all features with the same ID, does not have a parent/child hierarchy
                if (id) {
                    let transcript = transcripts[id];
                    if (transcript === undefined) {
                        transcript = new GFFTranscript(f);    // GTF does not require an explicit transcript record
                        transcripts[id] = transcript;
                        combinedFeatures.push(transcript);
                    }
                    transcript.addExon(f);
                    consumedFeatures.add(f)
                }
            }
        }

        // Apply CDS and UTR
        for (let f of features) {
            if (cdsTypes.has(f.type) || utrTypes.has(f.type) || codonTypes.has(f.type)) {
                const id = f.id;
                if (id) {
                    let transcript = transcripts[id];
                    if (transcript === undefined) {
                        transcript = new GFFTranscript(f);
                        transcripts[id] = transcript;
                        combinedFeatures.push(transcript);
                    }
                    if (utrTypes.has(f.type)) {
                        transcript.addUTR(f);
                    } else if (cdsTypes.has(f.type)) {
                        transcript.addCDS(f);
                    } else if (codonTypes.has(f.type)) {
                        // Ignore for now
                    }
                    consumedFeatures.add(f)
                }
            }
        }

        // Finish transcripts
        for (let f of combinedFeatures) {
            if (typeof f.finish === "function") {
                f.finish();
            }
        }

        // Add other features
        const others = features.filter(f => !consumedFeatures.has(f))
        for (let f of others) {
            combinedFeatures.push(f);
        }

        return combinedFeatures;

    }

    combineFeaturesGFF(features) {

        // Build dictionary of genes (optional)
        const genes = features.filter(f => "gene" === f.type);
        const geneMap = Object.create(null);
        for (let g of genes) {
            geneMap[g.id] = g;
        }

        // 1. Build dictionary of transcripts
        const transcripts = Object.create(null)
        const combinedFeatures = []
        const consumedFeatures = new Set();
        const filterTypes = this.filterTypes;

        features = features.filter(f => filterTypes === undefined || !filterTypes.has(f.type))

        for (let f of features) {
            if (transcriptTypes.has(f.type)) {
                const transcriptId = f.id; // getAttribute(f.attributeString, "transcript_id", /\s+/);
                if (undefined !== transcriptId) {
                    const gffTranscript = new GFFTranscript(f);
                    transcripts[transcriptId] = gffTranscript;
                    combinedFeatures.push(gffTranscript);
                    consumedFeatures.add(f);
                    const g = geneMap[f.parent];
                    if (g) {
                        gffTranscript.gene = geneMap[f.parent];
                        consumedFeatures.add(g);
                    }
                }
            }
        }

        // Remove assigned genes

        // Add exons
        for (let f of features) {
            if (exonTypes.has(f.type)) {
                const parents = getParents(f);
                if (parents) {
                    for (let id of parents) {
                        let transcript = transcripts[id];
                        if (transcript !== undefined) {
                            transcript.addExon(f);
                            consumedFeatures.add(f)
                        }
                    }
                }
            }
        }

        // Apply CDS and UTR
        for (let f of features) {
            if (cdsTypes.has(f.type) || utrTypes.has(f.type) || codonTypes.has(f.type)) {
                const parents = getParents(f);
                if (parents) {
                    for (let id of parents) {
                        let transcript = transcripts[id];
                        if (transcript !== undefined) {
                            if (utrTypes.has(f.type)) {
                                transcript.addUTR(f);
                            } else if (cdsTypes.has(f.type)) {
                                transcript.addCDS(f);
                            } else if (codonTypes.has(f.type)) {
                                // Ignore for now
                            }
                            consumedFeatures.add(f);
                        }
                    }
                }
            }
        }

        // Introns are ignored, but are consumed
        const introns = features.filter(f => intronType === f.type);
        for (let i of introns) {
            const parents = getParents(i);
            for (let id of parents) {
                if (transcripts[id]) {
                    consumedFeatures.add(i);
                    break;
                }
            }
        }

        // Finish transcripts
        combinedFeatures.forEach(function (f) {
            if (typeof f.finish === "function") {
                f.finish();
            }
        })

        // Add other features
        const others = features.filter(f => !consumedFeatures.has(f))
        for (let f of others) {
            combinedFeatures.push(f);
        }

        return combinedFeatures;

        function getParents(f) {
            if (f.parent && f.parent.trim() !== "") {
                return f.parent.trim().split(",");
            } else {
                return null;
            }
        }
    }
}

var GFFTranscript = function (feature) {
    Object.assign(this, feature);
    this.exons = [];
}

GFFTranscript.prototype.addExon = function (feature) {

    this.exons.push(feature)

    // Expand feature --  for transcripts not explicitly represented in the file
    this.start = Math.min(this.start, feature.start);
    this.end = Math.max(this.end, feature.end);
}

GFFTranscript.prototype.addCDS = function (cds) {

    let exon
    const exons = this.exons;

    // Find exon containing CDS
    for (let i = 0; i < exons.length; i++) {
        if (exons[i].start <= cds.start && exons[i].end >= cds.end) {
            exon = exons[i];
            break;
        }
    }

    if (exon) {
        exon.cdStart = exon.cdStart ? Math.min(cds.start, exon.cdStart) : cds.start;
        exon.cdEnd = exon.cdEnd ? Math.max(cds.end, exon.cdEnd) : cds.end;
        if (!exon.children) {
            exon.children = []
        }
        exon.children.push(cds)
    } else {
        cds.cdStart = cds.start
        cds.cdEnd = cds.end
        exons.push(cds)
    }

    // Expand feature --  for transcripts not explicitly represented in the file (gtf files)
    this.start = Math.min(this.start, cds.start);
    this.end = Math.max(this.end, cds.end);

    this.cdStart = this.cdStart ? Math.min(cds.start, this.cdStart) : cds.start;
    this.cdEnd = this.cdEnd ? Math.max(cds.end, this.cdEnd) : cds.end;
}

GFFTranscript.prototype.addUTR = function (utr) {

    let exon
    const exons = this.exons;

    // Find exon containing CDS
    for (let i = 0; i < exons.length; i++) {
        if (exons[i].start <= utr.start && exons[i].end >= utr.end) {
            exon = exons[i];
            break;
        }
    }

    if (exon) {
        if (utr.start === exon.start && utr.end === exon.end) {
            exon.utr = true;
        } else {
            if (utr.end < exon.end) {
                exon.cdStart = utr.end
            }
            if (utr.start > exon.start) {
                exon.cdEnd = utr.start
            }
        }
        if (!exon.children) {
            exon.children = []
        }
        exon.children.push(utr)

    } else {
        utr.utr = true
        exons.push(utr)
    }

    // Expand feature --  for transcripts not explicitly represented in the file
    this.start = Math.min(this.start, utr.start);
    this.end = Math.max(this.end, utr.end);

}

GFFTranscript.prototype.finish = function () {

    var cdStart = this.cdStart;
    var cdEnd = this.cdEnd;

    this.exons.sort(function (a, b) {
        return a.start - b.start;
    })

    // Search for UTR exons that were not explicitly tagged
    if (cdStart) {
        this.exons.forEach(function (exon) {
            if (exon.end < cdStart || exon.start > cdEnd) exon.utr = true;
        });
    }
}

GFFTranscript.prototype.popupData = function (genomicLocation) {

    const kvs = this.attributeString.split(';')
    const pd = []

    // If feature has an associated gene list its attributes first
    if (this.gene && typeof this.gene.popupData === 'function') {
        const gd = this.gene.popupData(genomicLocation);
        for (let e of gd) {
            pd.push(e);
        }
        pd.push("<hr>");
    }
    if (this.name) {
        pd.push({name: 'name', value: this.name})
    }
    pd.push({name: 'type', value: this.type})
    for (let kv of kvs) {
        var t = kv.trim().split(this.delim, 2);
        if (t.length === 2 && t[1] !== undefined) {
            const key = t[0].trim();
            if ('name' === key.toLowerCase()) continue;
            let value = t[1].trim();
            //Strip off quotes, if any
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.substr(1, value.length - 2);
            }
            pd.push({name: key, value: value});
        }
    }
    pd.push({
        name: 'position',
        value: `${this.chr}:${StringUtils.numberFormatter(this.start + 1)}-${StringUtils.numberFormatter(this.end)}`
    })


    // If clicked over an exon add its attributes
    for (let exon of this.exons) {
        if (genomicLocation >= exon.start && genomicLocation < exon.end && typeof exon.popupData === 'function') {
            pd.push("<hr>")
            const exonData = exon.popupData(genomicLocation)
            for (let att of exonData) {
                pd.push(att)
            }

            if (exon.children) {
                for (let c of exon.children) {
                    pd.push("<hr>")
                    const exonData = c.popupData(genomicLocation)
                    for (let att of exonData) {
                        pd.push(att)
                    }
                }
            }
        }
    }


    return pd;
}

export default GFFHelper;
