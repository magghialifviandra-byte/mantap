import type { JlptVocabEntry } from '../types';

export interface MinnaVocabSeed {
  wordFurigana: string;
  wordPlain: string;
  reading: string;
  meaningId: string;
  pos: string;
  sampleSentenceFurigana?: string;
  sampleAnswer?: string;
  sampleMeaningId?: string;
}

export interface MinnaChapterSpec {
  chapter: number;
  book: 1 | 2;
  titleJa: string;
  titleId: string;
  grammarFocus: string[];
  seeds: MinnaVocabSeed[];
}

export interface ProgramTopicSpec {
  id: string;
  labelJa: string;
  labelId: string;
  descriptionId: string;
  seeds: Array<{
    word: string;
    reading: string;
    meaningId: string;
    pos: string;
    sentenceBlank?: string;
    sentenceAnswer?: string;
    sentenceArrangeChunks?: string[];
    sentenceArrangeAnswer?: string;
    readingPassage?: string;
    readingQuestion?: string;
    readingAnswer?: string;
    readingDistractors?: string[];
  }>;
}

export const MINNA_CHAPTERS: MinnaChapterSpec[] = [
  {
    chapter: 1,
    book: 1,
    titleJa: '第1課：わたしはマイク・ミラーです',
    titleId: 'Bab 1: Perkenalan Diri & Pekerjaan (〜は〜です)',
    grammarFocus: ['N1 は N2 です', 'N1 は N2 じゃありません', '〜ですか', 'N1 の N2'],
    seeds: [
      { wordFurigana: '会社員[かいしゃいん]', wordPlain: '会社員', reading: 'かいしゃいん', meaningId: 'karyawan perusahaan', pos: 'noun', sampleSentenceFurigana: 'ミラーさんは IMC の（　　）です。', sampleAnswer: '会社員[かいしゃいん]', sampleMeaningId: 'Sdr. Miller adalah karyawan IMC.' },
      { wordFurigana: '銀行員[ぎんこういん]', wordPlain: '銀行員', reading: 'ぎんこういん', meaningId: 'pegawai bank', pos: 'noun' },
      { wordFurigana: '医者[いしゃ]', wordPlain: '医者', reading: 'いしゃ', meaningId: 'dokter', pos: 'noun' },
      { wordFurigana: '学生[がくせい]', wordPlain: '学生', reading: 'がくせい', meaningId: 'pelajar / mahasiswa', pos: 'noun' },
      { wordFurigana: '先生[せんせい]', wordPlain: '先生', reading: 'せんせい', meaningId: 'guru / instruktur', pos: 'noun' },
    ],
  },
  {
    chapter: 2,
    book: 1,
    titleJa: '第2課：これは本です',
    titleId: 'Bab 2: Kata Tunjuk Benda (これ・それ・あれ)',
    grammarFocus: ['これ / それ / あれ', 'この / その / あの N', 'そうです / そうじゃありません'],
    seeds: [
      { wordFurigana: '辞書[じしょ]', wordPlain: '辞書', reading: 'じしょ', meaningId: 'kamus', pos: 'noun', sampleSentenceFurigana: 'それは 日本語[にほんご]の（　　）です。', sampleAnswer: '辞書[じしょ]', sampleMeaningId: 'Itu adalah kamus bahasa Jepang.' },
      { wordFurigana: '時計[とけい]', wordPlain: '時計', reading: 'とけい', meaningId: 'jam tangan / jam dinding', pos: 'noun' },
      { wordFurigana: '手帳[てちょう]', wordPlain: '手帳', reading: 'てちょう', meaningId: 'buku catatan saku', pos: 'noun' },
      { wordFurigana: '新聞[しんぶん]', wordPlain: '新聞', reading: 'しんぶん', meaningId: 'koran', pos: 'noun' },
    ],
  },
  {
    chapter: 3,
    book: 1,
    titleJa: '第3課：ここはデパートです',
    titleId: 'Bab 3: Kata Tunjuk Tempat & Harga (ここ・そこ・あそこ)',
    grammarFocus: ['ここ / そこ / あそこ', 'N は Tempat です', 'いくらですか'],
    seeds: [
      { wordFurigana: '教室[きょうしつ]', wordPlain: '教室', reading: 'きょうしつ', meaningId: 'ruang kelas', pos: 'noun' },
      { wordFurigana: '食堂[しょくどう]', wordPlain: '食堂', reading: 'しょくどう', meaningId: 'kantin / ruang makan', pos: 'noun' },
      { wordFurigana: '事務所[じむしょ]', wordPlain: '事務所', reading: 'じむしょ', meaningId: 'kantor', pos: 'noun' },
      { wordFurigana: '受付[うけつけ]', wordPlain: '受付', reading: 'うけつけ', meaningId: 'resepsionis', pos: 'noun' },
    ],
  },
  {
    chapter: 4,
    book: 1,
    titleJa: '第4課：今何時ですか',
    titleId: 'Bab 4: Waktu, Hari, & Kata Kerja ます/ました',
    grammarFocus: ['今 何時 何分ですか', 'Vます / Vません / Vました', 'Waktu に V', 'N1 から N2 まで'],
    seeds: [
      { wordFurigana: '起きます[おきます]', wordPlain: '起きます', reading: 'おきます', meaningId: 'bangun tidur', pos: 'verb-ichidan' },
      { wordFurigana: '寝ます[ねます]', wordPlain: '寝ます', reading: 'ねます', meaningId: 'tidur', pos: 'verb-ichidan' },
      { wordFurigana: '働きます[はたらきます]', wordPlain: '働きます', reading: 'はたらきます', meaningId: 'bekerja', pos: 'verb-godan' },
      { wordFurigana: '休みます[やすみます]', wordPlain: '休みます', reading: 'やすみます', meaningId: 'beristirahat / libur', pos: 'verb-godan' },
      { wordFurigana: '勉強します[べんきょうします]', wordPlain: '勉強します', reading: 'べんきょうします', meaningId: 'belajar', pos: 'verb-suru' },
    ],
  },
  {
    chapter: 5,
    book: 1,
    titleJa: '第5課：京都へ行きます',
    titleId: 'Bab 5: Perpindahan, Transportasi, & Tanggal (へ・で・と)',
    grammarFocus: ['Tempat へ 行きます/来ます/帰ります', 'Alat で V', 'Orang と V', 'いつ'],
    seeds: [
      { wordFurigana: '行きます[いきます]', wordPlain: '行きます', reading: 'いきます', meaningId: 'pergi', pos: 'verb-godan' },
      { wordFurigana: '来ます[きます]', wordPlain: '来ます', reading: 'きます', meaningId: 'datang', pos: 'verb' },
      { wordFurigana: '帰ります[かえります]', wordPlain: '帰ります', reading: 'かえります', meaningId: 'pulang', pos: 'verb-godan' },
      { wordFurigana: '電車[でんしゃ]', wordPlain: '電車', reading: 'でんしゃ', meaningId: 'kereta listrik', pos: 'noun' },
      { wordFurigana: '飛行機[ひこうき]', wordPlain: '飛行機', reading: 'ひこうき', meaningId: 'pesawat terbang', pos: 'noun' },
    ],
  },
  {
    chapter: 6,
    book: 1,
    titleJa: '第6課：いっしょに行きませんか',
    titleId: 'Bab 6: Objek Langsung (を), Tempat Kegiatan (で), & Ajakan',
    grammarFocus: ['N を Vます', 'Tempat で Vます', 'Vませんか / Vましょう'],
    seeds: [
      { wordFurigana: '食べます[たべます]', wordPlain: '食べます', reading: 'たべます', meaningId: 'makan', pos: 'verb-ichidan' },
      { wordFurigana: '飲みます[のみます]', wordPlain: '飲みます', reading: 'のみます', meaningId: 'minum', pos: 'verb-godan' },
      { wordFurigana: '読みます[よみます]', wordPlain: '読みます', reading: 'よみます', meaningId: 'membaca', pos: 'verb-godan' },
      { wordFurigana: '買います[かいます]', wordPlain: '買います', reading: 'かいます', meaningId: 'membeli', pos: 'verb-godan' },
      { wordFurigana: '写真[しゃしん]', wordPlain: '写真', reading: 'しゃしん', meaningId: 'foto', pos: 'noun' },
    ],
  },
  {
    chapter: 7,
    book: 1,
    titleJa: '第7課：日本語でレポートを書きます',
    titleId: 'Bab 7: Alat/Bahasa (で), Memberi & Menerima (あげます・もらいます)',
    grammarFocus: ['Alat/Bahasa で V', 'Orang に あげます', 'Orang に/から もらいます', 'もう Vました'],
    seeds: [
      { wordFurigana: '切ります[きります]', wordPlain: '切ります', reading: 'きります', meaningId: 'memotong', pos: 'verb-godan' },
      { wordFurigana: '送ります[おくります]', wordPlain: '送ります', reading: 'おくります', meaningId: 'mengirim', pos: 'verb-godan' },
      { wordFurigana: '貸します[かします]', wordPlain: '貸します', reading: 'かします', meaningId: 'meminjamkan', pos: 'verb-godan' },
      { wordFurigana: '借ります[かります]', wordPlain: '借ります', reading: 'かります', meaningId: 'meminjam', pos: 'verb-ichidan' },
      { wordFurigana: '教えます[おしえます]', wordPlain: '教えます', reading: 'おしえます', meaningId: 'mengajar / memberi tahu', pos: 'verb-ichidan' },
    ],
  },
  {
    chapter: 8,
    book: 1,
    titleJa: '第8課：桜はきれいです',
    titleId: 'Bab 8: Kata Sifat-i (い) & Kata Sifat-na (な)',
    grammarFocus: ['な-adj です / じゃありません', 'い-adj です / くないです', 'どんな N', 'とても / あまり'],
    seeds: [
      { wordFurigana: '親切[しんせつ]', wordPlain: '親切', reading: 'しんせつ', meaningId: 'ramah / baik hati', pos: 'adj-na' },
      { wordFurigana: '元気[げんき]', wordPlain: '元気', reading: 'げんき', meaningId: 'sehat / bersemangat', pos: 'adj-na' },
      { wordFurigana: '静か[しずか]', wordPlain: '静か', reading: 'しずか', meaningId: 'tenang / sepi', pos: 'adj-na' },
      { wordFurigana: '高い[たかい]', wordPlain: '高い', reading: 'たかい', meaningId: 'mahal / tinggi', pos: 'adj-i' },
      { wordFurigana: '新しい[あたらしい]', wordPlain: '新しい', reading: 'あたらしい', meaningId: 'baru', pos: 'adj-i' },
    ],
  },
  {
    chapter: 9,
    book: 1,
    titleJa: '第9課：わたしは音楽が好きです',
    titleId: 'Bab 9: Kesukaan, Kemampuan, & Alasan (が・から)',
    grammarFocus: ['N が 好き/嫌い/上手/下手 です', 'N が わかります / あります', 'Kalimat から'],
    seeds: [
      { wordFurigana: '料理[りょうり]', wordPlain: '料理', reading: 'りょうり', meaningId: 'masakan', pos: 'noun' },
      { wordFurigana: '音楽[おんがく]', wordPlain: '音楽', reading: 'おんがく', meaningId: 'musik', pos: 'noun' },
      { wordFurigana: '上手[じょうず]', wordPlain: '上手', reading: 'じょうず', meaningId: 'pandai / mahir', pos: 'adj-na' },
      { wordFurigana: '約束[やくそく]', wordPlain: '約束', reading: 'やくそく', meaningId: 'janji', pos: 'noun' },
      { wordFurigana: '用事[ようじ]', wordPlain: '用事', reading: 'ようじ', meaningId: 'urusan / keperluan', pos: 'noun' },
    ],
  },
  {
    chapter: 10,
    book: 1,
    titleJa: '第10課：あそこにコンビニがあります',
    titleId: 'Bab 10: Keberadaan & Posisi (います・あります)',
    grammarFocus: ['N が います / あります', 'Tempat に N が あります', '上・下・前・後ろ・中・外'],
    seeds: [
      { wordFurigana: '部屋[へや]', wordPlain: '部屋', reading: 'へや', meaningId: 'kamar / ruangan', pos: 'noun' },
      { wordFurigana: '冷蔵庫[れいぞうこ]', wordPlain: '冷蔵庫', reading: 'れいぞうこ', meaningId: 'kulkas', pos: 'noun' },
      { wordFurigana: '家族[かぞく]', wordPlain: '家族', reading: 'かぞく', meaningId: 'keluarga', pos: 'noun' },
      { wordFurigana: '近く[ちかく]', wordPlain: '近く', reading: 'ちかく', meaningId: 'dekat', pos: 'noun' },
    ],
  },
  {
    chapter: 11,
    book: 1,
    titleJa: '第11課：りんごを4つ買いました',
    titleId: 'Bab 11: Kata Bilangan Bantu & Durasi Waktu',
    grammarFocus: ['いくつ / ひとり / ふたり', '〜人 / 〜台 / 〜枚 / 〜回', 'Durasi に 〜回'],
    seeds: [
      { wordFurigana: '兄弟[きょうだい]', wordPlain: '兄弟', reading: 'きょうだい', meaningId: 'saudara kandung', pos: 'noun' },
      { wordFurigana: '両親[りょうしん]', wordPlain: '両親', reading: 'りょうしん', meaningId: 'kedua orang tua', pos: 'noun' },
      { wordFurigana: '全部[ぜんぶ]', wordPlain: '全部', reading: 'ぜんぶ', meaningId: 'semuanya', pos: 'adv' },
      { wordFurigana: '封筒[ふうとう]', wordPlain: '封筒', reading: 'ふうとう', meaningId: 'amplop', pos: 'noun' },
    ],
  },
  {
    chapter: 12,
    book: 1,
    titleJa: '第12課：京都は静かでした',
    titleId: 'Bab 12: Lampau Kata Sifat & Perbandingan (より・いちばん)',
    grammarFocus: ['〜でした / かったです', 'N1 は N2 より Adj', 'N1 と N2 と どちらが', 'いちばん'],
    seeds: [
      { wordFurigana: '簡単[かんたん]', wordPlain: '簡単', reading: 'かんたん', meaningId: 'mudah / sederhana', pos: 'adj-na' },
      { wordFurigana: '近い[ちかい]', wordPlain: '近い', reading: 'ちかい', meaningId: 'dekat', pos: 'adj-i' },
      { wordFurigana: '遠い[とおい]', wordPlain: '遠い', reading: 'とおい', meaningId: 'jauh', pos: 'adj-i' },
      { wordFurigana: '季節[きせつ]', wordPlain: '季節', reading: 'きせつ', meaningId: 'musim', pos: 'noun' },
      { wordFurigana: '天気[てんき]', wordPlain: '天気', reading: 'てんき', meaningId: 'cuaca', pos: 'noun' },
    ],
  },
  {
    chapter: 13,
    book: 1,
    titleJa: '第13課：日本料理が食べたいです',
    titleId: 'Bab 13: Keinginan (ほしい・たい) & Tujuan Pergi (へ〜に行きます)',
    grammarFocus: ['N が ほしいです', 'Vたいです', 'Tempat へ Vます/N に 行きます'],
    seeds: [
      { wordFurigana: '遊びます[あそびます]', wordPlain: '遊びます', reading: 'あそびます', meaningId: 'bermain / berkunjung', pos: 'verb-godan' },
      { wordFurigana: '泳ぎます[およぎます]', wordPlain: '泳ぎます', reading: 'およぎます', meaningId: 'berenang', pos: 'verb-godan' },
      { wordFurigana: '迎えます[むかえます]', wordPlain: '迎えます', reading: 'むかえます', meaningId: 'menjemput', pos: 'verb-ichidan' },
      { wordFurigana: '疲れます[つかれます]', wordPlain: '疲れます', reading: 'つかれます', meaningId: 'lelah', pos: 'verb-ichidan' },
      { wordFurigana: '散歩[さんぽ]', wordPlain: '散歩', reading: 'さんぽ', meaningId: 'jalan-jalan santai', pos: 'noun' },
    ],
  },
  {
    chapter: 14,
    book: 1,
    titleJa: '第14課：ちょっと待ってください',
    titleId: 'Bab 14: Bentuk-て (て形), Permintaan, & Sedang Melakukan',
    grammarFocus: ['Vて ください', 'Vて います (sedang)', 'Vましょうか'],
    seeds: [
      { wordFurigana: 'つけます', wordPlain: 'つけます', reading: 'つけます', meaningId: 'menyalakan', pos: 'verb-ichidan' },
      { wordFurigana: '消します[けします]', wordPlain: '消します', reading: 'けします', meaningId: 'mematikan / menghapus', pos: 'verb-godan' },
      { wordFurigana: '開けます[あけます]', wordPlain: '開けます', reading: 'あけます', meaningId: 'membuka', pos: 'verb-ichidan' },
      { wordFurigana: '閉めます[しめます]', wordPlain: '閉めます', reading: 'しめます', meaningId: 'menutup', pos: 'verb-ichidan' },
      { wordFurigana: '手伝います[てつだいます]', wordPlain: '手伝います', reading: 'てつだいます', meaningId: 'membantu', pos: 'verb-godan' },
    ],
  },
  {
    chapter: 15,
    book: 1,
    titleJa: '第15課：写真を撮ってもいいですか',
    titleId: 'Bab 15: Izin (てもいいです), Larangan (てはいけません), & Keadaan',
    grammarFocus: ['Vて もいいですか', 'Vて はいけません', 'Vて います (pekerjaan/status)'],
    seeds: [
      { wordFurigana: '置きます[おきます]', wordPlain: '置きます', reading: 'おきます', meaningId: 'meletakkan', pos: 'verb-godan' },
      { wordFurigana: '作ります[つくります]', wordPlain: '作ります', reading: 'つくります', meaningId: 'membuat', pos: 'verb-godan' },
      { wordFurigana: '売ります[うります]', wordPlain: '売ります', reading: 'うります', meaningId: 'menjual', pos: 'verb-godan' },
      { wordFurigana: '知ります[しります]', wordPlain: '知ります', reading: 'しります', meaningId: 'tahu / mengenal', pos: 'verb-godan' },
      { wordFurigana: '住みます[すみます]', wordPlain: '住みます', reading: 'すみます', meaningId: 'tinggal / menetap', pos: 'verb-godan' },
    ],
  },
  {
    chapter: 16,
    book: 1,
    titleJa: '第16課：朝起きて、ご飯を食べます',
    titleId: 'Bab 16: Urutan Aksi (Vて、Vて) & Sambungan Kata Sifat',
    grammarFocus: ['V1て、V2て、V3', 'V1て から V2', 'い-adjくて / な-adjで'],
    seeds: [
      { wordFurigana: '乗ります[のります]', wordPlain: '乗ります', reading: 'のります', meaningId: 'naik kendaraan', pos: 'verb-godan' },
      { wordFurigana: '降ります[おります]', wordPlain: '降ります', reading: 'おります', meaningId: 'turun kendaraan', pos: 'verb-ichidan' },
      { wordFurigana: '乗り換えます[のりかえます]', wordPlain: '乗り換えます', reading: 'のりかえます', meaningId: 'ganti / transit kendaraan', pos: 'verb-ichidan' },
      { wordFurigana: '押します[おします]', wordPlain: '押します', reading: 'おします', meaningId: 'menekan / mendorong', pos: 'verb-godan' },
    ],
  },
  {
    chapter: 17,
    book: 1,
    titleJa: '第17課：パスポートを見せなければなりません',
    titleId: 'Bab 17: Bentuk-ない (ない形), Larangan, & Keharusan',
    grammarFocus: ['Vないで ください', 'Vなければ なりません', 'Vなくても いいです'],
    seeds: [
      { wordFurigana: '覚えます[おぼえます]', wordPlain: '覚えます', reading: 'おぼえます', meaningId: 'mengingat / menghafal', pos: 'verb-ichidan' },
      { wordFurigana: '忘れます[わすれます]', wordPlain: '忘れます', reading: 'わすれます', meaningId: 'lupa', pos: 'verb-ichidan' },
      { wordFurigana: 'なくします', wordPlain: 'なくします', reading: 'なくします', meaningId: 'menghilangkan', pos: 'verb-godan' },
      { wordFurigana: '払います[はらいます]', wordPlain: '払います', reading: 'はらいます', meaningId: 'membayar', pos: 'verb-godan' },
      { wordFurigana: '返します[かえします]', wordPlain: '返します', reading: 'かえします', meaningId: 'mengembalikan', pos: 'verb-godan' },
    ],
  },
  {
    chapter: 18,
    book: 1,
    titleJa: '第18課：ピアノを弾くことができます',
    titleId: 'Bab 18: Bentuk Kamus (辞書形), Kemampuan (ことができます), & Hobi',
    grammarFocus: ['N/V辞書形 ことができます', 'わたしの趣味は〜ことです', 'V辞書形 まえに'],
    seeds: [
      { wordFurigana: '運転します[うんてんします]', wordPlain: '運転します', reading: 'うんてんします', meaningId: 'menyetir', pos: 'verb-suru' },
      { wordFurigana: '予約します[よやくします]', wordPlain: '予約します', reading: 'よやくします', meaningId: 'memesan / reservasi', pos: 'verb-suru' },
      { wordFurigana: '趣味[しゅみ]', wordPlain: '趣味', reading: 'しゅみ', meaningId: 'hobi', pos: 'noun' },
      { wordFurigana: '日記[にっき]', wordPlain: '日記', reading: 'にっき', meaningId: 'buku harian', pos: 'noun' },
    ],
  },
  {
    chapter: 19,
    book: 1,
    titleJa: '第19課：すもうを見たことがあります',
    titleId: 'Bab 19: Bentuk-た (た形), Pengalaman (たことがある), & Perubahan',
    grammarFocus: ['Vた ことがあります', 'Vたり、Vたり します', '〜く/に なります'],
    seeds: [
      { wordFurigana: '登ります[のぼります]', wordPlain: '登ります', reading: 'のぼります', meaningId: 'mendaki', pos: 'verb-godan' },
      { wordFurigana: '泊まります[とまります]', wordPlain: '泊まります', reading: 'とまります', meaningId: 'menginap', pos: 'verb-godan' },
      { wordFurigana: '掃除します[そうじします]', wordPlain: '掃除します', reading: 'そうじします', meaningId: 'membersihkan', pos: 'verb-suru' },
      { wordFurigana: '洗濯します[せんたくします]', wordPlain: '洗濯します', reading: 'せんたくします', meaningId: 'mencuci pakaian', pos: 'verb-suru' },
    ],
  },
  {
    chapter: 20,
    book: 1,
    titleJa: '第20課：夏休みはいつですか（普通形）',
    titleId: 'Bab 20: Bentuk Biasa / Kasual (普通形)',
    grammarFocus: ['Kalimat Sopan vs Bentuk Biasa (普通形)', 'Percakapan kasual'],
    seeds: [
      { wordFurigana: '要ります[いります]', wordPlain: '要ります', reading: 'いります', meaningId: 'memerlukan / butuh', pos: 'verb-godan' },
      { wordFurigana: '調べます[しらべます]', wordPlain: '調べます', reading: 'しらべます', meaningId: 'memeriksa / mencari tahu', pos: 'verb-ichidan' },
      { wordFurigana: '修理します[しゅうりします]', wordPlain: '修理します', reading: 'しゅうりします', meaningId: 'memperbaiki', pos: 'verb-suru' },
      { wordFurigana: '着物[きもの]', wordPlain: '着物', reading: 'きもの', meaningId: 'kimono', pos: 'noun' },
    ],
  },
  {
    chapter: 21,
    book: 1,
    titleJa: '第21課：明日は雨が降ると思います',
    titleId: 'Bab 21: Pendapat (と思います), Kutipan (と言います), & Konfirmasi (でしょう)',
    grammarFocus: ['普通形 と思います', '〜と言いました', '〜でしょう？'],
    seeds: [
      { wordFurigana: '意見[いけん]', wordPlain: '意見', reading: 'いけん', meaningId: 'pendapat', pos: 'noun' },
      { wordFurigana: 'ニュース', wordPlain: 'ニュース', reading: 'ニュース', meaningId: 'berita', pos: 'noun' },
      { wordFurigana: '交通[こうつう]', wordPlain: '交通', reading: 'こうつう', meaningId: 'lalu lintas', pos: 'noun' },
      { wordFurigana: '会議[かいぎ]', wordPlain: '会議', reading: 'かいぎ', meaningId: 'rapat', pos: 'noun' },
    ],
  },
  {
    chapter: 22,
    book: 1,
    titleJa: '第22課：これはミラーさんが撮った写真です',
    titleId: 'Bab 22: Anak Kalimat Pejelas Kata Benda (修飾節)',
    grammarFocus: ['[普通形] + Kata Benda', '着ます・履きます・かぶります・かけます'],
    seeds: [
      { wordFurigana: '着ます[きます]', wordPlain: '着ます', reading: 'きます', meaningId: 'memakai (atasan/baju)', pos: 'verb-ichidan' },
      { wordFurigana: '履きます[はきます]', wordPlain: '履きます', reading: 'はきます', meaningId: 'memakai (sepatu/celana)', pos: 'verb-godan' },
      { wordFurigana: '眼鏡[めがね]', wordPlain: '眼鏡', reading: 'めがね', meaningId: 'kacamata', pos: 'noun' },
      { wordFurigana: '家賃[やちん]', wordPlain: '家賃', reading: 'やちん', meaningId: 'uang sewa rumah', pos: 'noun' },
    ],
  },
  {
    chapter: 23,
    book: 1,
    titleJa: '第23課：図書館で本を借りるとき',
    titleId: 'Bab 23: Klausa Waktu (〜とき) & Kondisi Otomatis (〜と)',
    grammarFocus: ['V辞書形/Vない/た とき', 'V辞書形 と、〜'],
    seeds: [
      { wordFurigana: '聞きます[ききます]', wordPlain: '聞きます', reading: 'ききます', meaningId: 'bertanya / mendengar', pos: 'verb-godan' },
      { wordFurigana: '回します[まわします]', wordPlain: '回します', reading: 'まわします', meaningId: 'memutar', pos: 'verb-godan' },
      { wordFurigana: '引きます[ひきます]', wordPlain: '引きます', reading: 'ひきます', meaningId: 'menarik', pos: 'verb-godan' },
      { wordFurigana: '故障[こしょう]', wordPlain: '故障', reading: 'こしょう', meaningId: 'kerusakan mesin', pos: 'noun' },
      { wordFurigana: '交差点[こうさてん]', wordPlain: '交差点', reading: 'こうさてん', meaningId: 'perempatan jalan', pos: 'noun' },
    ],
  },
  {
    chapter: 24,
    book: 1,
    titleJa: '第24課：佐藤さんが教えてくれました',
    titleId: 'Bab 24: Memberi & Menerima Jasa (てあげる・てもらう・てくれる)',
    grammarFocus: ['Vて くれます', 'Vて もらいます', 'Vて あげます'],
    seeds: [
      { wordFurigana: '直します[なおします]', wordPlain: '直します', reading: 'なおします', meaningId: 'memperbaiki', pos: 'verb-godan' },
      { wordFurigana: '連れて行きます[つれていきます]', wordPlain: '連れて行きます', reading: 'つれていきます', meaningId: 'mengajak pergi', pos: 'verb-godan' },
      { wordFurigana: '送ります[おくります]', wordPlain: '送ります', reading: 'おくります', meaningId: 'mengantar orang', pos: 'verb-godan' },
      { wordFurigana: '紹介します[しょうかいします]', wordPlain: '紹介します', reading: 'しょうかいします', meaningId: 'memperkenalkan', pos: 'verb-suru' },
    ],
  },
  {
    chapter: 25,
    book: 1,
    titleJa: '第25課：雨が降ったら、出かけません',
    titleId: 'Bab 25: Pengandaian (〜たら) & Meskipun (〜ても)',
    grammarFocus: ['〜たら、〜', '〜ても、〜', 'もし〜たら / いくら〜ても'],
    seeds: [
      { wordFurigana: '考えます[かんがえます]', wordPlain: '考えます', reading: 'かんがえます', meaningId: 'berpikir / mempertimbangkan', pos: 'verb-ichidan' },
      { wordFurigana: '着きます[つきます]', wordPlain: '着きます', reading: 'つきます', meaningId: 'tiba / sampai', pos: 'verb-godan' },
      { wordFurigana: '頑張ります[がんばります]', wordPlain: '頑張ります', reading: 'がんばります', meaningId: 'berusaha keras', pos: 'verb-godan' },
      { wordFurigana: '田舎[いなか]', wordPlain: '田舎', reading: 'いなか', meaningId: 'kampung halaman / pedesaan', pos: 'noun' },
    ],
  },
  {
    chapter: 26,
    book: 2,
    titleJa: '第26課：ゴミはどこに出したらいいですか',
    titleId: 'Bab 26: Penjelasan/Alasan (〜んです) & Meminta Saran (〜たらいいですか)',
    grammarFocus: ['普通形 んです', '〜て いただけませんか', '疑問詞〜たら いいですか'],
    seeds: [
      { wordFurigana: '連絡します[れんらくします]', wordPlain: '連絡します', reading: 'れんらくします', meaningId: 'menghubungi', pos: 'verb-suru' },
      { wordFurigana: '片づけます[かたづけます]', wordPlain: '片づけます', reading: 'かたづけます', meaningId: 'membereskan', pos: 'verb-ichidan' },
      { wordFurigana: '燃えるゴミ[もえるゴミ]', wordPlain: '燃えるゴミ', reading: 'もえるごみ', meaningId: 'sampah yang bisa dibakar', pos: 'noun' },
      { wordFurigana: '場所[ばしょ]', wordPlain: '場所', reading: 'ばしょ', meaningId: 'tempat / lokasi', pos: 'noun' },
    ],
  },
  {
    chapter: 27,
    book: 2,
    titleJa: '第27課：日本語の新聞が読めます',
    titleId: 'Bab 27: Kata Kerja Potensial (可能形) & Kontras Partikel (しか・は)',
    grammarFocus: ['V可能形', '見えます / 聞こえます', '〜しか〜ません'],
    seeds: [
      { wordFurigana: '建てます[たてます]', wordPlain: '建てます', reading: 'たてます', meaningId: 'membangun', pos: 'verb-ichidan' },
      { wordFurigana: '走ります[はしります]', wordPlain: '走ります', reading: 'はしります', meaningId: 'berlari', pos: 'verb-godan' },
      { wordFurigana: '将来[しょうらい]', wordPlain: '将来', reading: 'しょうらい', meaningId: 'masa depan', pos: 'noun' },
      { wordFurigana: '夢[ゆめ]', wordPlain: '夢', reading: 'ゆめ', meaningId: 'mimpi / cita-cita', pos: 'noun' },
    ],
  },
  {
    chapter: 28,
    book: 2,
    titleJa: '第28課：音楽を聞きながら勉強します',
    titleId: 'Bab 28: Sambil (ながら), Kebiasaan (ています), & Alasan Beruntun (し)',
    grammarFocus: ['Vます ながら', '〜し、〜し', 'それで'],
    seeds: [
      { wordFurigana: '経験[けいけん]', wordPlain: '経験', reading: 'けいけん', meaningId: 'pengalaman', pos: 'noun' },
      { wordFurigana: '習慣[しゅうかん]', wordPlain: '習慣', reading: 'しゅうかん', meaningId: 'kebiasaan', pos: 'noun' },
      { wordFurigana: 'アルバイト', wordPlain: 'アルバイト', reading: 'アルバイト', meaningId: 'kerja paruh waktu', pos: 'noun' },
      { wordFurigana: '熱心[ねっしん]', wordPlain: '熱心', reading: 'ねっしん', meaningId: 'tekun / antusias', pos: 'adj-na' },
    ],
  },
  {
    chapter: 29,
    book: 2,
    titleJa: '第29課：窓が開いています',
    titleId: 'Bab 29: Hasil Keadaan (Vています) & Penyesalan/Selesai (てしまいました)',
    grammarFocus: ['V自動詞 ています', 'Vて しまいました'],
    seeds: [
      { wordFurigana: '壊れます[こわれます]', wordPlain: '壊れます', reading: 'こわれます', meaningId: 'rusak (intransitif)', pos: 'verb-ichidan' },
      { wordFurigana: '割れます[われます]', wordPlain: '割れます', reading: 'われます', meaningId: 'pecah (intransitif)', pos: 'verb-ichidan' },
      { wordFurigana: '汚れます[よごれます]', wordPlain: '汚れます', reading: 'よごれます', meaningId: 'menjadi kotor', pos: 'verb-ichidan' },
      { wordFurigana: '忘れます[わすれます]', wordPlain: '忘れます', reading: 'わすれます', meaningId: 'terlupa / tertinggal', pos: 'verb-ichidan' },
    ],
  },
  {
    chapter: 30,
    book: 2,
    titleJa: '第30課：カレンダーが掛けてあります',
    titleId: 'Bab 30: Keadaan Disengaja (てあります) & Persiapan (ておきます)',
    grammarFocus: ['N が V他動詞 てあります', 'Vて おきます'],
    seeds: [
      { wordFurigana: '並べます[ならべます]', wordPlain: '並べます', reading: 'ならべます', meaningId: 'menata / menyusun', pos: 'verb-ichidan' },
      { wordFurigana: '予定[よてい]', wordPlain: '予定', reading: 'よてい', meaningId: 'rencana / jadwal', pos: 'noun' },
      { wordFurigana: '案内書[あんないしょ]', wordPlain: '案内書', reading: 'あんないしょ', meaningId: 'buku panduan', pos: 'noun' },
      { wordFurigana: '黒板[こくばん]', wordPlain: '黒板', reading: 'こくばん', meaningId: 'papan tulis', pos: 'noun' },
    ],
  },
  {
    chapter: 31,
    book: 2,
    titleJa: '第31課：日本へ帰ろうと思います',
    titleId: 'Bab 31: Bentuk Maksud/Ajakan (意向形) & Rencana (つもりです)',
    grammarFocus: ['V意向形 と思っています', 'V辞書形/ない つもりです', 'V辞書形 予定です'],
    seeds: [
      { wordFurigana: '続けます[つづけます]', wordPlain: '続けます', reading: 'つづけます', meaningId: 'melanjutkan', pos: 'verb-ichidan' },
      { wordFurigana: '見つけます[みつけます]', wordPlain: '見つけます', reading: 'みつけます', meaningId: 'menemukan', pos: 'verb-ichidan' },
      { wordFurigana: '入学[にゅうがく]', wordPlain: '入学', reading: 'にゅうがく', meaningId: 'masuk sekolah', pos: 'noun' },
      { wordFurigana: '卒業[そつぎょう]', wordPlain: '卒業', reading: 'そつぎょう', meaningId: 'lulus sekolah', pos: 'noun' },
    ],
  },
  {
    chapter: 32,
    book: 2,
    titleJa: '第32課：毎日運動したほうがいいです',
    titleId: 'Bab 32: Saran (たほうがいい) & Kemungkinan (かもしれません)',
    grammarFocus: ['Vた/Vない ほうが いいです', '〜でしょう / かもしれません'],
    seeds: [
      { wordFurigana: '運動します[うんどうします]', wordPlain: '運動します', reading: 'うんどうします', meaningId: 'berolahraga', pos: 'verb-suru' },
      { wordFurigana: '成功します[せいこうします]', wordPlain: '成功します', reading: 'せいこうします', meaningId: 'berhasil / sukses', pos: 'verb-suru' },
      { wordFurigana: '失敗します[しっぱいします]', wordPlain: '失敗します', reading: 'しっぱいします', meaningId: 'gagal', pos: 'verb-suru' },
      { wordFurigana: '熱[ねつ]', wordPlain: '熱', reading: 'ねつ', meaningId: 'demam / panas', pos: 'noun' },
    ],
  },
  {
    chapter: 33,
    book: 2,
    titleJa: '第33課：危ないから、入るな',
    titleId: 'Bab 33: Bentuk Perintah & Larangan (命令形・禁止形)',
    grammarFocus: ['V命令形 / V辞書形+な', '〜と書いてあります', '〜という意味です'],
    seeds: [
      { wordFurigana: '逃げます[にげます]', wordPlain: '逃げます', reading: 'にげます', meaningId: 'melarikan diri', pos: 'verb-ichidan' },
      { wordFurigana: '騒ぎます[さわぎます]', wordPlain: '騒ぎます', reading: 'さわぎます', meaningId: 'membuat keributan', pos: 'verb-godan' },
      { wordFurigana: '禁止[きんし]', wordPlain: '禁止', reading: 'きんし', meaningId: 'larangan', pos: 'noun' },
      { wordFurigana: '非常口[ひじょうぐち]', wordPlain: '非常口', reading: 'ひじょうぐち', meaningId: 'pintu darurat', pos: 'noun' },
    ],
  },
  {
    chapter: 34,
    book: 2,
    titleJa: '第34課：わたしがしたとおりにしてください',
    titleId: 'Bab 34: Sesuai (とおりに), Setelah (あとで), & Tanpa (ないで)',
    grammarFocus: ['Vた/Nの とおりに', 'Vた/Nの あとで', 'Vて/ないで'],
    seeds: [
      { wordFurigana: '磨きます[みがきます]', wordPlain: '磨きます', reading: 'みがきます', meaningId: 'menggosok / menyikat', pos: 'verb-godan' },
      { wordFurigana: '組み立てます[くみたてます]', wordPlain: '組み立てます', reading: 'くみたてます', meaningId: 'merakit', pos: 'verb-ichidan' },
      { wordFurigana: '説明書[せつめいしょ]', wordPlain: '説明書', reading: 'せつめいしょ', meaningId: 'buku petunjuk', pos: 'noun' },
      { wordFurigana: '図[ず]', wordPlain: '図', reading: 'ず', meaningId: 'diagram / gambar bagan', pos: 'noun' },
    ],
  },
  {
    chapter: 35,
    book: 2,
    titleJa: '第35課：春になれば、桜が咲きます',
    titleId: 'Bab 35: Bentuk Syarat (条件形 〜ば) & Makin... Makin...',
    grammarFocus: ['Vば / い-adjければ / な-adjなら', 'N なら', '〜ば 〜ほど'],
    seeds: [
      { wordFurigana: '咲きます[さきます]', wordPlain: '咲きます', reading: 'さきます', meaningId: 'mekar (bunga)', pos: 'verb-godan' },
      { wordFurigana: '変わります[かわります]', wordPlain: '変わります', reading: 'かわります', meaningId: 'berubah', pos: 'verb-godan' },
      { wordFurigana: '相談します[そうだんします]', wordPlain: '相談します', reading: 'そうだんします', meaningId: 'berkonsultasi', pos: 'verb-suru' },
      { wordFurigana: '方法[ほうほう]', wordPlain: '方法', reading: 'ほうほう', meaningId: 'cara / metode', pos: 'noun' },
    ],
  },
  {
    chapter: 36,
    book: 2,
    titleJa: '第36課：日本語が話せるようになりました',
    titleId: 'Bab 36: Agar Supaya (ように) & Perubahan Kemampuan (ようになりました)',
    grammarFocus: ['V辞書形/ない ように', '〜ように なります', '〜ように しています'],
    seeds: [
      { wordFurigana: '届きます[とどきます]', wordPlain: '届きます', reading: 'とどきます', meaningId: 'sampai / terkirim', pos: 'verb-godan' },
      { wordFurigana: '習慣[しゅうかん]', wordPlain: '習慣', reading: 'しゅうかん', meaningId: 'kebiasaan', pos: 'noun' },
      { wordFurigana: '安全[あんぜん]', wordPlain: '安全', reading: 'あんぜん', meaningId: 'aman / keselamatan', pos: 'adj-na' },
      { wordFurigana: '工場[こうじょう]', wordPlain: '工場', reading: 'こうじょう', meaningId: 'pabrik', pos: 'noun' },
    ],
  },
  {
    chapter: 37,
    book: 2,
    titleJa: '第37課：先生に褒められました',
    titleId: 'Bab 37: Kalimat Pasif (受身形 〜られる)',
    grammarFocus: ['N1 は N2 に V受身', 'N が V受身 (penemuan/peristiwa)', '〜によって'],
    seeds: [
      { wordFurigana: '褒めます[ほめます]', wordPlain: '褒めます', reading: 'ほめます', meaningId: 'memuji', pos: 'verb-ichidan' },
      { wordFurigana: '叱ります[しかります]', wordPlain: '叱ります', reading: 'しかります', meaningId: 'memarahi', pos: 'verb-godan' },
      { wordFurigana: '誘います[さそいます]', wordPlain: '誘います', reading: 'さそいます', meaningId: 'mengajak', pos: 'verb-godan' },
      { wordFurigana: '招待します[しょうたいします]', wordPlain: '招待します', reading: 'しょうたいします', meaningId: 'mengundang', pos: 'verb-suru' },
    ],
  },
  {
    chapter: 38,
    book: 2,
    titleJa: '第38課：漢字を書くのは難しいです',
    titleId: 'Bab 38: Nominalisasi Kata Kerja dengan の (〜のは / 〜のが / 〜のを)',
    grammarFocus: ['V辞書形 のは Adj です', 'V辞書形 のが 好き/上手 です', 'V辞書形 のを 忘れました'],
    seeds: [
      { wordFurigana: '育てます[そだてます]', wordPlain: '育てます', reading: 'そだてます', meaningId: 'membesarkan / merawat tanaman', pos: 'verb-ichidan' },
      { wordFurigana: '運びます[はこびます]', wordPlain: '運びます', reading: 'はこびます', meaningId: 'mengangkut / membawa', pos: 'verb-godan' },
      { wordFurigana: '参加します[さんかします]', wordPlain: '参加します', reading: 'さんかします', meaningId: 'berpartisipasi', pos: 'verb-suru' },
      { wordFurigana: '整理します[せいりします]', wordPlain: '整理します', reading: 'せいりします', meaningId: 'merapikan / menyortir', pos: 'verb-suru' },
    ],
  },
  {
    chapter: 39,
    book: 2,
    titleJa: '第39課：遅れてすみません',
    titleId: 'Bab 39: Sebab Akibat Perasaan & Kejadian (Vて・〜ので)',
    grammarFocus: ['Vて / Adjくて (sebab)', 'Nで (sebab)', '普通形 ので'],
    seeds: [
      { wordFurigana: '遅れます[おくれます]', wordPlain: '遅れます', reading: 'おくれます', meaningId: 'terlambat', pos: 'verb-ichidan' },
      { wordFurigana: '安心します[あんしんします]', wordPlain: '安心します', reading: 'あんしんします', meaningId: 'merasa lega', pos: 'verb-suru' },
      { wordFurigana: '台風[たいふう]', wordPlain: '台風', reading: 'たいふう', meaningId: 'angin topan', pos: 'noun' },
      { wordFurigana: '火事[かじ]', wordPlain: '火事', reading: 'かじ', meaningId: 'kebakaran', pos: 'noun' },
      { wordFurigana: '事故[じこ]', wordPlain: '事故', reading: 'じこ', meaningId: 'kecelakaan', pos: 'noun' },
    ],
  },
  {
    chapter: 40,
    book: 2,
    titleJa: '第40課：友達が来るかどうか分かりません',
    titleId: 'Bab 40: Kalimat Tanya Sisipan (〜か / 〜かどうか) & Mencoba (てみます)',
    grammarFocus: ['疑問詞 〜か', '〜かどうか', 'Vて みます'],
    seeds: [
      { wordFurigana: '数えます[かぞえます]', wordPlain: '数えます', reading: 'かぞえます', meaningId: 'menghitung', pos: 'verb-ichidan' },
      { wordFurigana: '測ります[はかります]', wordPlain: '測ります', reading: 'はかります', meaningId: 'mengukur / menimbang', pos: 'verb-godan' },
      { wordFurigana: '確かめます[たしかめます]', wordPlain: '確かめます', reading: 'たしかめます', meaningId: 'memastikan / mengecek', pos: 'verb-ichidan' },
      { wordFurigana: '間違い[まちがい]', wordPlain: '間違い', reading: 'まちがい', meaningId: 'kesalahan', pos: 'noun' },
    ],
  },
  {
    chapter: 41,
    book: 2,
    titleJa: '第41課：部長にいただきました',
    titleId: 'Bab 41: Memberi & Menerima Berderajat Sopan (いただきます・くださいます・やります)',
    grammarFocus: ['いただきます / くださいます / やります', 'Vて くださいます / いただきます / いただけますか'],
    seeds: [
      { wordFurigana: 'お祝い[おいわい]', wordPlain: 'お祝い', reading: 'おいわい', meaningId: 'ucapan selamat / hadiah perayaan', pos: 'noun' },
      { wordFurigana: 'お見舞い[おみまい]', wordPlain: 'お見舞い', reading: 'おみまい', meaningId: 'menjenguk orang sakit', pos: 'noun' },
      { wordFurigana: '荷物[にもつ]', wordPlain: '荷物', reading: 'にもつ', meaningId: 'barang bawaan / paket', pos: 'noun' },
      { wordFurigana: '預かります[あずかります]', wordPlain: '預かります', reading: 'あずかります', meaningId: 'menitipkan / menjaga titipan', pos: 'verb-godan' },
    ],
  },
  {
    chapter: 42,
    book: 2,
    titleJa: '第42課：日本へ留学するために働いています',
    titleId: 'Bab 42: Tujuan (〜ために) & Kegunaan/Penilaian (〜のに)',
    grammarFocus: ['V辞書形/Nの ために', 'V辞書形 のに 便利です/かかります'],
    seeds: [
      { wordFurigana: '留学[りゅうがく]', wordPlain: '留学', reading: 'りゅうがく', meaningId: 'belajar di luar negeri', pos: 'noun' },
      { wordFurigana: '目的[もくてき]', wordPlain: '目的', reading: 'もくてき', meaningId: 'tujuan', pos: 'noun' },
      { wordFurigana: '貯金[ちょきん]', wordPlain: '貯金', reading: 'ちょきん', meaningId: 'tabungan', pos: 'noun' },
      { wordFurigana: '平和[へいわ]', wordPlain: '平和', reading: 'へいわ', meaningId: 'perdamaian', pos: 'noun' },
    ],
  },
  {
    chapter: 43,
    book: 2,
    titleJa: '第43課：今にも雨が降りそうです',
    titleId: 'Bab 43: Sepertinya / Tampaknya (〜そうです) & Pergi lalu Kembali (てきます)',
    grammarFocus: ['Vます/Adj語幹 そうです (tampaknya)', 'Vて きます'],
    seeds: [
      { wordFurigana: '増えます[ふえます]', wordPlain: '増えます', reading: 'ふえます', meaningId: 'bertambah', pos: 'verb-ichidan' },
      { wordFurigana: '減ります[へります]', wordPlain: '減ります', reading: 'へります', meaningId: 'berkurang', pos: 'verb-godan' },
      { wordFurigana: '上がります[あがります]', wordPlain: '上がります', reading: 'あがります', meaningId: 'naik / meningkat', pos: 'verb-godan' },
      { wordFurigana: '下がります[さがります]', wordPlain: '下がります', reading: 'さがります', meaningId: 'turun / menurun', pos: 'verb-godan' },
    ],
  },
  {
    chapter: 44,
    book: 2,
    titleJa: '第44課：飲みすぎました',
    titleId: 'Bab 44: Terlalu Berlebihan (〜すぎます) & Mudah/Sulit (〜やすい・にくい)',
    grammarFocus: ['Vます/Adj すぎます', 'Vます やすい/にくい です', '〜く/に します'],
    seeds: [
      { wordFurigana: '泣きます[なきます]', wordPlain: '泣きます', reading: 'なきます', meaningId: 'menangis', pos: 'verb-godan' },
      { wordFurigana: '笑います[わらいます]', wordPlain: '笑います', reading: 'わらいます', meaningId: 'tertawa', pos: 'verb-godan' },
      { wordFurigana: '乾きます[かわきます]', wordPlain: '乾きます', reading: 'かわきます', meaningId: 'mengering', pos: 'verb-godan' },
      { wordFurigana: '濡れます[ぬれます]', wordPlain: '濡れます', reading: 'ぬれます', meaningId: 'menjadi basah', pos: 'verb-ichidan' },
    ],
  },
  {
    chapter: 45,
    book: 2,
    titleJa: '第45課：約束の時間に遅れた場合は',
    titleId: 'Bab 45: Apabila / Jika Terjadi (〜場合は) & Padahal (〜のに)',
    grammarFocus: ['〜場合は、〜', '普通形 のに、〜'],
    seeds: [
      { wordFurigana: '信じます[しんじます]', wordPlain: '信じます', reading: 'しんじます', meaningId: 'percaya', pos: 'verb-ichidan' },
      { wordFurigana: 'キャンセルします', wordPlain: 'キャンセルします', reading: 'キャンセルします', meaningId: 'membatalkan', pos: 'verb-suru' },
      { wordFurigana: '通知[つうち]', wordPlain: '通知', reading: 'つうち', meaningId: 'pemberitahuan', pos: 'noun' },
      { wordFurigana: '地震[じしん]', wordPlain: '地震', reading: 'じしん', meaningId: 'gempa bumi', pos: 'noun' },
    ],
  },
  {
    chapter: 46,
    book: 2,
    titleJa: '第46課：バスは今出たところです',
    titleId: 'Bab 46: Baru Saja / Akan / Sedang (〜ところ) & Baru Selesai (〜ばかり)',
    grammarFocus: ['V辞書形/ている/た ところです', 'Vた ばかりです', '〜はずです'],
    seeds: [
      { wordFurigana: '渡します[わたします]', wordPlain: '渡します', reading: 'わたします', meaningId: 'menyerahkan', pos: 'verb-godan' },
      { wordFurigana: '返事[へんじ]', wordPlain: '返事', reading: 'へんじ', meaningId: 'balasan / jawaban', pos: 'noun' },
      { wordFurigana: '配達[はいたつ]', wordPlain: '配達', reading: 'はいたつ', meaningId: 'pengantaran / kurir', pos: 'noun' },
      { wordFurigana: '到着[とうちゃく]', wordPlain: '到着', reading: 'とうちゃく', meaningId: 'kedatangan / tiba', pos: 'noun' },
    ],
  },
  {
    chapter: 47,
    book: 2,
    titleJa: '第47課：天気予報によると、明日は寒いそうです',
    titleId: 'Bab 47: Kabarnya (そうです) & Kelihatannya Menurut Dugaan (ようです)',
    grammarFocus: ['〜によると 〜そうです (kabarnya)', '〜ようです (dugaan)'],
    seeds: [
      { wordFurigana: '天気予報[てんきよほう]', wordPlain: '天気予報', reading: 'てんきよほう', meaningId: 'ramalan cuaca', pos: 'noun' },
      { wordFurigana: '発表[はっぴょう]', wordPlain: '発表', reading: 'はっぴょう', meaningId: 'pengumuman / presentasi', pos: 'noun' },
      { wordFurigana: '実験[じっけん]', wordPlain: '実験', reading: 'じっけん', meaningId: 'percobaan / eksperimen', pos: 'noun' },
      { wordFurigana: 'におい', wordPlain: 'におい', reading: 'におい', meaningId: 'bau / aroma', pos: 'noun' },
    ],
  },
  {
    chapter: 48,
    book: 2,
    titleJa: '第48課：社長はわたしに大阪へ行かせました',
    titleId: 'Bab 48: Bentuk Kausatif / Menyuruh-Membiarkan (使役形 〜させる)',
    grammarFocus: ['V使役形 (membuat/menyuruh/mengizinkan)', 'V使役て いただけませんか'],
    seeds: [
      { wordFurigana: '出席します[しゅっせきします]', wordPlain: '出席します', reading: 'しゅっせきします', meaningId: 'hadir', pos: 'verb-suru' },
      { wordFurigana: '休憩します[きゅうけいします]', wordPlain: '休憩します', reading: 'きゅうけいします', meaningId: 'beristirahat sejenak', pos: 'verb-suru' },
      { wordFurigana: '自由[じゆう]', wordPlain: '自由', reading: 'じゆう', meaningId: 'bebas / kebebasan', pos: 'adj-na' },
      { wordFurigana: '規則[きそく]', wordPlain: '規則', reading: 'きそく', meaningId: 'peraturan', pos: 'noun' },
    ],
  },
  {
    chapter: 49,
    book: 2,
    titleJa: '第49課：社長はもうお帰りになりました',
    titleId: 'Bab 49: Bahasa Hormat / Sonkeigo (尊敬語)',
    grammarFocus: ['お Vます になります', 'おっしゃいます / いらっしゃいます / なさいます / ご覧になります'],
    seeds: [
      { wordFurigana: 'いらっしゃいます', wordPlain: 'いらっしゃいます', reading: 'いらっしゃいます', meaningId: 'ada / pergi / datang (hormat)', pos: 'verb-godan' },
      { wordFurigana: 'おっしゃいます', wordPlain: 'おっしゃいます', reading: 'おっしゃいます', meaningId: 'berkata (hormat)', pos: 'verb-godan' },
      { wordFurigana: '召し上がります[めしあがります]', wordPlain: '召し上がります', reading: 'めしあがります', meaningId: 'makan / minum (hormat)', pos: 'verb-godan' },
      { wordFurigana: 'ご覧になります[ごらんになります]', wordPlain: 'ご覧になります', reading: 'ごらんになります', meaningId: 'melihat (hormat)', pos: 'verb-godan' },
    ],
  },
  {
    chapter: 50,
    book: 2,
    titleJa: '第50課：わたしがご案内いたします',
    titleId: 'Bab 50: Bahasa Merendah / Kenjougo (謙譲語)',
    grammarFocus: ['お Vます します / いたします', 'まいります / おります / 申します / 伺います'],
    seeds: [
      { wordFurigana: 'まいります', wordPlain: 'まいります', reading: 'まいります', meaningId: 'pergi / datang (merendah)', pos: 'verb-godan' },
      { wordFurigana: 'おります', wordPlain: 'おります', reading: 'おります', meaningId: 'berada (merendah)', pos: 'verb-godan' },
      { wordFurigana: 'いただきます', wordPlain: 'いただきます', reading: 'いただきます', meaningId: 'makan / menerima (merendah)', pos: 'verb-godan' },
      { wordFurigana: '拝見します[はいけんします]', wordPlain: '拝見します', reading: 'はいけんします', meaningId: 'melihat (merendah)', pos: 'verb-suru' },
    ],
  },
];

export const JLPT_N4_TOPICS: ProgramTopicSpec[] = [
  {
    id: 'n4_kanji_vocab',
    labelJa: 'JLPT N4 文字・語彙',
    labelId: 'JLPT N4 Kanji & Kosakata (Tanpa Furigana)',
    descriptionId: 'Uji bacaan kanji N4, pemakaian kata, dan pemahaman makna tanpa bantuan furigana.',
    seeds: [
      {
        word: '経験',
        reading: 'けいけん',
        meaningId: 'pengalaman',
        pos: 'noun',
        sentenceBlank: '日本での仕事の（　　）がやくにたちました。',
        sentenceAnswer: '経験',
        sentenceArrangeChunks: ['仕事の', '日本での', '★', '役に立ちました'],
        sentenceArrangeAnswer: '経験が',
      },
      {
        word: '約束',
        reading: 'やくそく',
        meaningId: 'janji',
        pos: 'noun',
        sentenceBlank: '友達と土曜日に会う（　　）をしました。',
        sentenceAnswer: '約束',
      },
      {
        word: '習慣',
        reading: 'しゅうかん',
        meaningId: 'kebiasaan',
        pos: 'noun',
        sentenceBlank: '国の（　　）についてスピーチをしました。',
        sentenceAnswer: '習慣',
      },
      {
        word: '準備',
        reading: 'じゅんび',
        meaningId: 'persiapan',
        pos: 'noun',
        sentenceBlank: '試験の前にしっかり（　　）しておきます。',
        sentenceAnswer: '準備',
      },
      {
        word: '届ける',
        reading: 'とどける',
        meaningId: 'mengantarkan / menyerahkan',
        pos: 'verb-ichidan',
        sentenceBlank: 'この荷物を事務所まで（　　）ください。',
        sentenceAnswer: '届けて',
      },
    ],
  },
  {
    id: 'n4_grammar_reading',
    labelJa: 'JLPT N4 文法・読解',
    labelId: 'JLPT N4 Tata Bahasa & Dokkai (Tanpa Furigana)',
    descriptionId: 'Latihan partikel, konjugasi N4 (pasif/kausatif/saran), susun kalimat ★, dan bacaan singkat.',
    seeds: [
      {
        word: 'お礼',
        reading: 'おれい',
        meaningId: 'ucapan terima kasih',
        pos: 'noun',
        sentenceBlank: '先生に親切にして（　　）ので、お礼を言いました。',
        sentenceAnswer: 'もらった',
        sentenceArrangeChunks: ['明日', '雨が', '★', '出かけません'],
        sentenceArrangeAnswer: '降ったら',
        readingPassage: '私は来年、日本で働く予定です。今、毎日2時間日本語を勉強しています。最初は漢字が難しかったですが、毎日少しずつ練習しているので、だんだん読めるようになってきました。',
        readingQuestion: 'この人は今、どうして漢字が読めるようになってきましたか。',
        readingAnswer: '毎日少しずつ練習しているから',
        readingDistractors: [
          'もう日本で働いているから',
          '漢字がとても簡単だから',
          '1日だけ勉強したから',
        ],
      },
      {
        word: '遅れる',
        reading: 'おくれる',
        meaningId: 'terlambat',
        pos: 'verb-ichidan',
        sentenceBlank: '電車が止まったので、会社に（　　）しまいました。',
        sentenceAnswer: '遅れて',
      },
      {
        word: '確認',
        reading: 'かくにん',
        meaningId: 'konfirmasi / pengecekan',
        pos: 'noun',
        sentenceBlank: 'メールを送る前に、名前が正しいか（　　）みます。',
        sentenceAnswer: '確認して',
      },
    ],
  },
];

export const JFT_A2_TOPICS: ProgramTopicSpec[] = [
  {
    id: 'jft_daily_work',
    labelJa: 'JFT-Basic A2 生活・仕事表現',
    labelId: 'JFT-Basic A2 Kehidupan & Kerja (Tanpa Furigana)',
    descriptionId: 'Kosakata kerja praktis, etika percakapan tempat kerja, serta membaca pengumuman A2 tanpa furigana.',
    seeds: [
      {
        word: '体調',
        reading: 'たいちょう',
        meaningId: 'kondisi tubuh / kesehatan',
        pos: 'noun',
        sentenceBlank: 'すみません、今朝から（　　）が悪いので、病院へ行ってもいいですか。',
        sentenceAnswer: '体調',
        sentenceArrangeChunks: ['明日の', '会議は', '★', '始まります'],
        sentenceArrangeAnswer: '9時から',
        readingPassage: 'お知らせ：来週の月曜日は工場の掃除のため、昼の休憩時間が12時から13時までになります。午前中の作業が終わったら、道具を元の場所に戻してください。',
        readingQuestion: '来週の月曜日、作業が終わったら何をしなければなりませんか。',
        readingAnswer: '道具を元の場所に戻します',
        readingDistractors: [
          'すぐ家に帰ります',
          '13時から掃除を始めます',
          '工場の外で昼ごはんを食べます',
        ],
      },
      {
        word: '連絡',
        reading: 'れんらく',
        meaningId: 'menghubungi / memberi kabar',
        pos: 'noun',
        sentenceBlank: '休むときは、必ず朝8時までに会社へ（　　）してください。',
        sentenceAnswer: '連絡',
      },
      {
        word: 'ルール',
        reading: 'ルール',
        meaningId: 'aturan / tata tertib',
        pos: 'noun',
        sentenceBlank: 'ゴミの出し方の（　　）を守ってください。',
        sentenceAnswer: 'ルール',
      },
      {
        word: '安全',
        reading: 'あんぜん',
        meaningId: 'keselamatan / aman',
        pos: 'adj-na',
        sentenceBlank: '工場の中では（　　）のため、ヘルメットをかぶります。',
        sentenceAnswer: '安全',
      },
      {
        word: '申し込む',
        reading: 'もうしこむ',
        meaningId: 'mendaftar / mengajukan',
        pos: 'verb-godan',
        sentenceBlank: '市役所で健康保険を（　　）たいです。',
        sentenceAnswer: '申し込み',
      },
    ],
  },
];

export function vocabEntryToDisplayString(entry: JlptVocabEntry): string {
  const meanings =
    entry.meaningId.length > 0 ? entry.meaningId.join(', ') : entry.meaningEn.join(', ');
  return `${entry.word}（${entry.reading}）: ${meanings}`;
}
