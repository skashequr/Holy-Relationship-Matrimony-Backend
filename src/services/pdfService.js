const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const FONT_PATH = path.join(__dirname, '../../fonts/SolaimanLipi.ttf');

async function generateBiodataPDF(biodata) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Register Bengali font if available
    const hasBengaliFont = fs.existsSync(FONT_PATH);
    if (hasBengaliFont) {
      doc.registerFont('Bengali', FONT_PATH);
    }

    const boldFont = hasBengaliFont ? 'Bengali' : 'Helvetica-Bold';
    const normalFont = hasBengaliFont ? 'Bengali' : 'Helvetica';

    // ── Header ──
    doc.font(boldFont).fontSize(18).fillColor('#1a5276')
      .text('Holy Relationship Marriage Matrimony', { align: 'center' });
    doc.font(normalFont).fontSize(10).fillColor('#555')
      .text('হোলি রিলেশনশিপ ম্যারেজ ম্যাট্রিমনি', { align: 'center' });
    doc.moveDown(0.3);
    doc.font(normalFont).fontSize(9).fillColor('#888')
      .text(`ডাউনলোডের তারিখ: ${new Date().toLocaleDateString('en-GB')} | গোপনীয় নথি`, { align: 'center' });
    doc.moveTo(50, doc.y + 8).lineTo(545, doc.y + 8).stroke('#1a5276');
    doc.moveDown(1);

    // Helper: section title
    const sectionTitle = (title) => {
      doc.font(boldFont).fontSize(12).fillColor('#1a5276').text(title);
      doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke('#1a5276');
      doc.moveDown(0.5);
    };

    // Helper: row
    const row = (label, value) => {
      if (!value && value !== 0) return;
      doc.font(boldFont).fontSize(10).fillColor('#333').text(`${label}: `, { continued: true });
      doc.font(normalFont).fontSize(10).fillColor('#555').text(String(value));
    };

    const p = biodata.personal || {};
    const rel = biodata.religion || {};
    const edu = biodata.education || {};
    const prof = biodata.profession || {};
    const fam = biodata.family || {};
    const addr = biodata.address || {};
    const contact = biodata.contact || {};
    const lifestyle = biodata.lifestyle || {};
    const pe = biodata.partnerExpectations || {};

    // ── Personal ──
    sectionTitle('ব্যক্তিগত তথ্য');
    row('পূর্ণ নাম', p.fullName);
    row('পিতার নাম', p.fatherName);
    row('মাতার নাম', p.motherName);
    row('জন্ম তারিখ', p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString('en-GB') : null);
    row('বয়স', p.age ? `${p.age} বছর` : null);
    row('বৈবাহিক অবস্থা', p.maritalStatus);
    row('উচ্চতা', p.height ? `${p.height} সেমি` : null);
    row('ওজন', p.weight ? `${p.weight} কেজি` : null);
    row('গায়ের রং', p.complexion);
    row('রক্তের গ্রুপ', p.bloodGroup);
    doc.moveDown(0.8);

    // ── Religion ──
    sectionTitle('ধর্মীয় তথ্য');
    row('মাযহাব', rel.madhab);
    row('পাঁচ ওয়াক্ত নামাজ', rel.praysFiveTimes ? 'হ্যাঁ' : 'না');
    doc.moveDown(0.8);

    // ── Education ──
    sectionTitle('শিক্ষাগত তথ্য');
    row('সর্বোচ্চ শিক্ষা', edu.highestLevel);
    row('বিষয়', edu.subject);
    row('প্রতিষ্ঠান', edu.institution);
    row('পাশের বছর', edu.passingYear);
    doc.moveDown(0.8);

    // ── Profession ──
    sectionTitle('পেশাগত তথ্য');
    row('পেশা', prof.occupationType);
    row('প্রতিষ্ঠান', prof.organization);
    row('মাসিক আয়', prof.monthlyIncome ? `৳${prof.monthlyIncome}` : null);
    doc.moveDown(0.8);

    // ── Family ──
    sectionTitle('পারিবারিক তথ্য');
    row('পিতার পেশা', fam.fatherProfession);
    row('মাতার পেশা', fam.motherProfession);
    row('পারিবারিক অবস্থা', fam.economicStatus);
    doc.moveDown(0.8);

    // ── Address ──
    sectionTitle('ঠিকানা');
    row('বর্তমান ঠিকানা', addr.currentDistrict);
    row('স্থায়ী ঠিকানা', addr.permanentDistrict);
    doc.moveDown(0.8);

    // ── Contact ──
    sectionTitle('যোগাযোগ');
    row('মোবাইল', contact.phone);
    row('ইমেইল', contact.email);
    row('অভিভাবকের মোবাইল', contact.guardianPhone);
    doc.moveDown(0.8);

    // ── Partner Expectations ──
    sectionTitle('প্রত্যাশিত জীবনসঙ্গী');
    row('বয়স সীমা', pe.ageMin && pe.ageMax ? `${pe.ageMin}–${pe.ageMax} বছর` : null);
    row('পছন্দের শিক্ষা', pe.preferredEducation);
    row('পছন্দের জেলা', pe.preferredDistrict);
    row('বিস্তারিত', pe.partnerDescription);
    doc.moveDown(2);

    // ── Footer ──
    doc.font(normalFont).fontSize(8).fillColor('#aaa')
      .text('Downloaded from HolyRelationship.com | এই বায়োডেটা গোপনীয়', { align: 'center' });

    doc.end();
  });
}

module.exports = { generateBiodataPDF };
