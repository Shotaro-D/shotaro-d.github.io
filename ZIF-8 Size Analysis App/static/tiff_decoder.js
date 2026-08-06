"use strict";

(function attachSemTiffDecoder(globalObject) {
  const TYPE_BYTES = new Map([
    [1, 1],  // BYTE
    [2, 1],  // ASCII
    [3, 2],  // SHORT
    [4, 4],  // LONG
    [5, 8],  // RATIONAL
    [6, 1],  // SBYTE
    [7, 1],  // UNDEFINED
    [8, 2],  // SSHORT
    [9, 4],  // SLONG
    [10, 8], // SRATIONAL
    [11, 4], // FLOAT
    [12, 8], // DOUBLE
    [13, 4], // IFD
  ]);
  const MAX_PIXELS = 250_000_000;

  function fail(message) {
    throw new Error(`TIFFを原寸でデコードできません：${message}`);
  }

  function checkedRange(offset, length, totalLength, label) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
        || offset < 0 || length < 0 || offset + length > totalLength) {
      fail(`${label}がファイル範囲外です。`);
    }
  }

  function decodeTiff(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) fail("入力がArrayBufferではありません。 ");
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 8) fail("ヘッダーが短すぎます。 ");
    const byte0 = view.getUint8(0);
    const byte1 = view.getUint8(1);
    const littleEndian = byte0 === 0x49 && byte1 === 0x49;
    const bigEndian = byte0 === 0x4d && byte1 === 0x4d;
    if (!littleEndian && !bigEndian) fail("byte order markerが不正です。 ");
    if (view.getUint16(2, littleEndian) !== 42) fail("Classic TIFFではありません。 ");

    const ifdOffset = view.getUint32(4, littleEndian);
    checkedRange(ifdOffset, 2, view.byteLength, "IFD");
    const entryCount = view.getUint16(ifdOffset, littleEndian);
    checkedRange(ifdOffset + 2, entryCount * 12 + 4, view.byteLength, "IFD entries");
    const tags = new Map();

    function readEntryValues(entryOffset, type, count) {
      const typeBytes = TYPE_BYTES.get(type);
      if (!typeBytes) fail(`未対応のTIFF field typeです（type=${type}）。`);
      const byteLength = typeBytes * count;
      const valueOffset = byteLength <= 4
        ? entryOffset + 8
        : view.getUint32(entryOffset + 8, littleEndian);
      checkedRange(valueOffset, byteLength, view.byteLength, "TIFF tag value");
      const values = [];
      for (let index = 0; index < count; index += 1) {
        const offset = valueOffset + index * typeBytes;
        if (type === 3) values.push(view.getUint16(offset, littleEndian));
        else if (type === 4 || type === 13) values.push(view.getUint32(offset, littleEndian));
        else if (type === 5) {
          const denominator = view.getUint32(offset + 4, littleEndian);
          values.push(denominator ? view.getUint32(offset, littleEndian) / denominator : Number.NaN);
        } else if (type === 6) values.push(view.getInt8(offset));
        else if (type === 8) values.push(view.getInt16(offset, littleEndian));
        else if (type === 9) values.push(view.getInt32(offset, littleEndian));
        else if (type === 10) {
          const denominator = view.getInt32(offset + 4, littleEndian);
          values.push(denominator ? view.getInt32(offset, littleEndian) / denominator : Number.NaN);
        } else if (type === 11) values.push(view.getFloat32(offset, littleEndian));
        else if (type === 12) values.push(view.getFloat64(offset, littleEndian));
        else values.push(view.getUint8(offset));
      }
      return values;
    }

    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);
      if (count > 10_000_000) fail(`TIFF tag ${tag}の要素数が過大です。`);
      tags.set(tag, readEntryValues(entryOffset, type, count));
    }

    function first(tag, fallback = null) {
      const values = tags.get(tag);
      return values && values.length ? values[0] : fallback;
    }

    function bytesFor(tag) {
      const values = tags.get(tag);
      return values && values.length ? Uint8Array.from(values) : null;
    }

    function required(tag, label) {
      const value = first(tag);
      if (value === null) fail(`${label} tag（${tag}）がありません。`);
      return value;
    }

    const width = required(256, "ImageWidth");
    const height = required(257, "ImageLength");
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
      fail(`画像寸法が不正または過大です（${width}×${height}）。`);
    }
    const compression = first(259, 1);
    if (compression !== 1) {
      fail(`圧縮TIFFには未対応です（Compression=${compression}）。原本は変更しません。`);
    }
    const photometric = first(262, 1);
    if (![0, 1, 2].includes(photometric)) {
      fail(`未対応のPhotometricInterpretationです（${photometric}）。`);
    }
    const samplesPerPixel = first(277, photometric === 2 ? 3 : 1);
    if (![1, 2, 3, 4].includes(samplesPerPixel)) {
      fail(`未対応のSamplesPerPixelです（${samplesPerPixel}）。`);
    }
    const planarConfiguration = first(284, 1);
    if (planarConfiguration !== 1) fail("planar TIFFには未対応です。 ");
    const predictor = first(317, 1);
    if (predictor !== 1) fail(`未対応のPredictorです（${predictor}）。`);
    const orientation = first(274, 1);
    if (orientation !== 1) {
      fail(`Orientation=${orientation}には未対応です。座標を暗黙変換しません。`);
    }
    const bitsPerSample = tags.get(258) || [8];
    if (!bitsPerSample.every((value) => value === 8)) {
      fail(`8-bit TIFF以外には未対応です（BitsPerSample=${bitsPerSample.join(",")}）。`);
    }
    const sampleFormat = tags.get(339) || [1];
    if (!sampleFormat.every((value) => value === 1)) {
      fail(`unsigned integer以外のSampleFormatには未対応です。`);
    }
    const stripOffsets = tags.get(273);
    const stripByteCounts = tags.get(279);
    if (!stripOffsets?.length || !stripByteCounts?.length) {
      fail("StripOffsetsまたはStripByteCountsがありません。 ");
    }
    if (stripByteCounts.length !== 1 && stripByteCounts.length !== stripOffsets.length) {
      fail("strip offset数とbyte count数が一致しません。 ");
    }
    const rowsPerStrip = first(278, height);
    if (!Number.isSafeInteger(rowsPerStrip) || rowsPerStrip <= 0) {
      fail("RowsPerStripが不正です。 ");
    }

    const rowBytes = width * samplesPerPixel;
    const raw = new Uint8Array(width * height * samplesPerPixel);
    let copiedRows = 0;
    for (let stripIndex = 0; stripIndex < stripOffsets.length && copiedRows < height; stripIndex += 1) {
      const rows = Math.min(rowsPerStrip, height - copiedRows);
      const expectedBytes = rows * rowBytes;
      const byteCount = stripByteCounts.length === 1
        ? stripByteCounts[0]
        : stripByteCounts[stripIndex];
      if (byteCount < expectedBytes) fail(`strip ${stripIndex + 1}のデータが不足しています。`);
      const offset = stripOffsets[stripIndex];
      checkedRange(offset, expectedBytes, view.byteLength, `strip ${stripIndex + 1}`);
      raw.set(new Uint8Array(arrayBuffer, offset, expectedBytes), copiedRows * rowBytes);
      copiedRows += rows;
    }
    if (copiedRows !== height) fail(`全行を復元できませんでした（${copiedRows}/${height}）。`);

    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0, source = 0, target = 0; pixel < width * height; pixel += 1) {
      if (photometric === 2) {
        rgba[target] = raw[source];
        rgba[target + 1] = raw[source + 1];
        rgba[target + 2] = raw[source + 2];
        rgba[target + 3] = samplesPerPixel >= 4 ? raw[source + 3] : 255;
      } else {
        const gray = photometric === 0 ? 255 - raw[source] : raw[source];
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = samplesPerPixel >= 2 ? raw[source + 1] : 255;
      }
      source += samplesPerPixel;
      target += 4;
    }
    return {
      width,
      height,
      rgba,
      metadata: {
        sourceFormat: "TIFF",
        compression,
        bitsPerSample: [...bitsPerSample],
        samplesPerPixel,
        photometric,
        resampled: false,
        // Hitachi stores PixelSize and MicronMarker in this UTF-16LE
        // XPComment (TIFF tag 40092).  Keep the raw bytes local so the
        // browser-side calibration code can parse them without uploading the
        // original TIFF.
        hitachiXpCommentBytes: bytesFor(40092),
      },
    };
  }

  globalObject.SemTiffDecoder = Object.freeze({ decodeTiff });
}(typeof window !== "undefined" ? window : globalThis));
