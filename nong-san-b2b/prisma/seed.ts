import { PrismaClient, Role, SeasonStatus, CertType } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Tính thứ Hai của tuần
function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  date.setDate(diff)
  date.setHours(0, 0, 0, 0)
  return date
}

async function main() {
  console.log('🌱 Bắt đầu seed dữ liệu mẫu...')

  // 1. Nhóm khách hàng (Customer Groups)
  console.log('-> Tạo nhóm khách hàng...')
  const groupTier1 = await prisma.customerGroup.upsert({
    where: { code: 'TIER1_AGENT' },
    update: { discountPercent: 5 },
    create: {
      code: 'TIER1_AGENT',
      name: 'Đại lý cấp 1',
      discountPercent: 5,
      isDefault: false,
    },
  })

  const groupSupermarket = await prisma.customerGroup.upsert({
    where: { code: 'SUPERMARKET' },
    update: { discountPercent: 3 },
    create: {
      code: 'SUPERMARKET',
      name: 'Siêu thị',
      discountPercent: 3,
      isDefault: false,
    },
  })

  const groupSmallShop = await prisma.customerGroup.upsert({
    where: { code: 'SMALL_SHOP' },
    update: { discountPercent: 0 },
    create: {
      code: 'SMALL_SHOP',
      name: 'Cửa hàng nhỏ',
      discountPercent: 0,
      isDefault: true,
    },
  })

  // 2. Tài khoản Admin & Khách hàng demo
  console.log('-> Tạo tài khoản Admin và khách hàng demo...')
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nongsanb2b.vn'
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword@123'
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10)
  const demoPasswordHash = await bcrypt.hash('Demo@123', 10)

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminPasswordHash, role: Role.ADMIN },
    create: {
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      fullName: 'Ban Quản Trị B2B',
      phone: '0901234567',
      companyName: 'Công Ty CP Thương Mại Nông Sản B2B',
      taxCode: '0300123456',
    },
  })

  // Demo User 1: Đại lý cấp 1
  await prisma.user.upsert({
    where: { email: 'daily1@nongsanb2b.vn' },
    update: { groupId: groupTier1.id },
    create: {
      email: 'daily1@nongsanb2b.vn',
      passwordHash: demoPasswordHash,
      role: Role.CUSTOMER,
      fullName: 'Trần Văn Đại',
      phone: '0911223344',
      companyName: 'Công ty TNHH Phân Phối Nông Sản Miền Tây',
      taxCode: '0312345678',
      groupId: groupTier1.id,
      addresses: {
        create: {
          label: 'Tổng kho Miền Tây',
          recipient: 'Trần Văn Đại',
          phone: '0911223344',
          line: 'Số 120 Đường Nguyễn Thị Thập',
          ward: 'Phường Bình Thuận',
          district: 'Quận 7',
          province: 'TP. Hồ Chí Minh',
          isDefault: true,
          lat: 10.7412,
          lng: 106.7188,
        },
      },
    },
  })

  // Demo User 2: Siêu thị
  await prisma.user.upsert({
    where: { email: 'sieuthi@nongsanb2b.vn' },
    update: { groupId: groupSupermarket.id },
    create: {
      email: 'sieuthi@nongsanb2b.vn',
      passwordHash: demoPasswordHash,
      role: Role.CUSTOMER,
      fullName: 'Nguyễn Thị Bích',
      phone: '0922334455',
      companyName: 'Chuỗi Siêu Thị Thực Phẩm Xanh',
      taxCode: '0387654321',
      groupId: groupSupermarket.id,
      addresses: {
        create: {
          label: 'Kho Trung tâm Thủ Đức',
          recipient: 'Nguyễn Thị Bích',
          phone: '0922334455',
          line: 'Số 45 Đường Song Hành Xa Lộ Hà Nội',
          ward: 'Phường An Phú',
          district: 'TP. Thủ Đức',
          province: 'TP. Hồ Chí Minh',
          isDefault: true,
          lat: 10.8032,
          lng: 106.7456,
        },
      },
    },
  })

  // Demo User 3: Cửa hàng nhỏ (Mặc định)
  await prisma.user.upsert({
    where: { email: 'taphoa@nongsanb2b.vn' },
    update: { groupId: groupSmallShop.id },
    create: {
      email: 'taphoa@nongsanb2b.vn',
      passwordHash: demoPasswordHash,
      role: Role.CUSTOMER,
      fullName: 'Lê Hoàng Ba',
      phone: '0933445566',
      companyName: 'Cửa Hàng Trái Cây Sạch Cô Ba',
      taxCode: '8412349876',
      groupId: groupSmallShop.id,
      addresses: {
        create: {
          label: 'Cửa hàng chính',
          recipient: 'Lê Hoàng Ba',
          phone: '0933445566',
          line: 'Số 88 Đường Lê Văn Sỹ',
          ward: 'Phường 12',
          district: 'Quận 3',
          province: 'TP. Hồ Chí Minh',
          isDefault: true,
          lat: 10.7891,
          lng: 106.6782,
        },
      },
    },
  })

  // 3. Nhà vườn liên kết (Farms)
  console.log('-> Tạo danh sách nhà vườn và chứng nhận...')
  const farm1 = await prisma.farm.upsert({
    where: { slug: 'htx-sau-rieng-ngu-hiep-tien-giang' },
    update: {},
    create: {
      slug: 'htx-sau-rieng-ngu-hiep-tien-giang',
      name: 'Hợp Tác Xã Sầu Riêng Ngũ Hiệp (Tiền Giang)',
      ownerName: 'Ông Huỳnh Văn Bảy',
      province: 'Tiền Giang',
      addressText: 'Xã Ngũ Hiệp, Huyện Cai Lậy, Tỉnh Tiền Giang',
      description:
        'Vùng chuyên canh sầu riêng lớn nhất miền Tây với diện tích hơn 200 hecta, đất phù sa bồi đắp màu mỡ, chuyên sản xuất Sầu riêng Ri6 và Monthong đạt chuẩn xuất khẩu.',
      lat: 10.3394,
      lng: 106.0712,
      images: [
        'https://images.unsplash.com/photo-1595231776515-ddffb1f4eb73?auto=format&fit=crop&w=800&q=80',
      ],
      certificates: {
        create: [
          {
            type: CertType.VIETGAP,
            code: 'VIETGAP-TG-2024-001',
            issuedAt: new Date('2024-01-15'),
            expiresAt: new Date('2027-01-15'),
            imageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80',
          },
          {
            type: CertType.GLOBALGAP,
            code: 'GG-VN-2024-987',
            issuedAt: new Date('2024-03-01'),
            expiresAt: new Date('2027-03-01'),
            imageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80',
          },
        ],
      },
    },
  })

  const farm2 = await prisma.farm.upsert({
    where: { slug: 'vuon-buoi-da-xanh-mo-cay-nam-ben-tre' },
    update: {},
    create: {
      slug: 'vuon-buoi-da-xanh-mo-cay-nam-ben-tre',
      name: 'Vườn Bưởi Da Xanh Mỏ Cày Nam (Bến Tre)',
      ownerName: 'Bà Nguyễn Thị Mai',
      province: 'Bến Tre',
      addressText: 'Xã Định Thủy, Huyện Mỏ Cày Nam, Tỉnh Bến Tre',
      description:
        'Trang trại chuyên canh bưởi da xanh ruột hồng không hạt, canh tác theo hướng hữu cơ sinh học, tưới tiêu nước ngọt tự nhiên từ sông Hàm Luông.',
      lat: 10.1558,
      lng: 106.3275,
      images: [
        'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=800&q=80',
      ],
      certificates: {
        create: [
          {
            type: CertType.VIETGAP,
            code: 'VIETGAP-BT-2023-888',
            issuedAt: new Date('2023-06-20'),
            expiresAt: new Date('2026-06-20'),
            imageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80',
          },
        ],
      },
    },
  })

  const farm3 = await prisma.farm.upsert({
    where: { slug: 'nong-truong-bo-sau-rieng-krong-pac-dak-lak' },
    update: {},
    create: {
      slug: 'nong-truong-bo-sau-rieng-krong-pac-dak-lak',
      name: 'Nông Trường Bơ & Sầu Riêng Krông Pắc (Đắk Lắk)',
      ownerName: 'Ông Đặng Quốc Dũng',
      province: 'Đắk Lắk',
      addressText: 'Thị trấn Phước An, Huyện Krông Pắc, Tỉnh Đắk Lắk',
      description:
        'Vùng đất đỏ bazan màu mỡ độ cao 500m so với mực nước biển, tạo nên vị sầu riêng Monthong béo đậm đà và bơ sáp 034 cơm vàng dẻo đặc sản.',
      lat: 12.6842,
      lng: 108.2713,
      images: [
        'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=800&q=80',
      ],
      certificates: {
        create: [
          {
            type: CertType.GLOBALGAP,
            code: 'GG-DL-2024-456',
            issuedAt: new Date('2024-05-10'),
            expiresAt: new Date('2027-05-10'),
            imageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80',
          },
        ],
      },
    },
  })

  // 4. Sản phẩm & Bậc giá & Quy cách (Products)
  console.log('-> Tạo danh mục sản phẩm vụ mùa, quy cách và bảng giá bậc...')

  // SP 1: Sầu riêng Ri6 (Farm 1) - Sản phẩm chuẩn test case
  const pRi6 = await prisma.product.upsert({
    where: { slug: 'sau-rieng-ri6' },
    update: {},
    create: {
      slug: 'sau-rieng-ri6',
      name: 'Sầu Riêng Ri6 Cai Lậy (Cơm Vàng Hạt Lép)',
      description:
        'Sầu riêng Ri6 thu hoạch già đủ độ, cơm vàng ráo, vị ngọt béo đậm đà, mùi thơm nồng nàn. Hàng cắt tại vườn tuyển chọn loại 1, tỷ lệ sượng dưới 1%.',
      images: [
        'https://images.unsplash.com/photo-1595231776515-ddffb1f4eb73?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm1.id,
      moqGrams: 50000, // 50kg
      leadTimeDays: 2,
      seasonStatus: SeasonStatus.HARVESTING,
      requiresCold: true,
      packagings: {
        create: [
          { name: 'Thùng carton 10kg', weightGrams: 10000, isSample: false },
          { name: 'Rổ nhựa 20kg', weightGrams: 20000, isSample: false },
          {
            name: 'Hộp mẫu thử 2kg (1 quả test chất lượng)',
            weightGrams: 2000,
            isSample: true,
            samplePrice: 200000,
          },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 50000, pricePerKg: 80000 },
          { minGrams: 200000, pricePerKg: 75000 },
        ],
      },
    },
  })

  // SP 2: Sầu riêng Monthong Dona (Farm 3)
  await prisma.product.upsert({
    where: { slug: 'sau-rieng-monthong-dona' },
    update: {},
    create: {
      slug: 'sau-rieng-monthong-dona',
      name: 'Sầu Riêng Monthong Dona Tây Nguyên',
      description:
        'Trái to đều từ 3.5 - 5kg, cơm dày màu mỡ gà, vị béo ngọt thanh, thời gian bảo quản sau thu hoạch bền thích hợp vận chuyển xa và xuất bán siêu thị.',
      images: [
        'https://images.unsplash.com/photo-1595231776515-ddffb1f4eb73?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm3.id,
      moqGrams: 50000,
      leadTimeDays: 2,
      seasonStatus: SeasonStatus.HARVESTING,
      requiresCold: true,
      packagings: {
        create: [
          { name: 'Thùng carton 10kg', weightGrams: 10000, isSample: false },
          { name: 'Rổ nhựa 20kg', weightGrams: 20000, isSample: false },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 50000, pricePerKg: 85000 },
          { minGrams: 200000, pricePerKg: 80000 },
        ],
      },
    },
  })

  // SP 3: Bưởi Da Xanh Bến Tre (Farm 2)
  const pBuoi = await prisma.product.upsert({
    where: { slug: 'buoi-da-xanh-ben-tre' },
    update: {},
    create: {
      slug: 'buoi-da-xanh-ben-tre',
      name: 'Bưởi Da Xanh Ruột Hồng Bến Tre (Loại 1: 1.4kg - 1.8kg)',
      description:
        'Vỏ xanh mỏng, ruột hồng đỏ thắm, tép bưởi mọng nước giòn ngọt không the. Đạt chuẩn xuất khẩu và cung cấp cho các chuỗi siêu thị lớn.',
      images: [
        'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm2.id,
      moqGrams: 40000, // 40kg
      leadTimeDays: 1,
      seasonStatus: SeasonStatus.HARVESTING,
      requiresCold: false,
      packagings: {
        create: [
          { name: 'Bao lưới 20kg (12-14 quả)', weightGrams: 20000, isSample: false },
          { name: 'Thùng giấy 10kg quà tặng', weightGrams: 10000, isSample: false },
          {
            name: 'Gói mẫu 1 quả thử vị (1.5kg)',
            weightGrams: 1500,
            isSample: true,
            samplePrice: 75000,
          },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 40000, pricePerKg: 45000 },
          { minGrams: 100000, pricePerKg: 40000 },
        ],
      },
    },
  })

  // SP 4: Xoài Cát Hòa Lộc (Farm 1)
  await prisma.product.upsert({
    where: { slug: 'xoai-cat-hoa-loc' },
    update: {},
    create: {
      slug: 'xoai-cat-hoa-loc',
      name: 'Xoài Cát Hòa Lộc Tiền Giang Chuẩn Xuất Khẩu',
      description:
        'Trọng lượng 450g - 600g/quả, quả thon dài, thịt mịn chắc không xơ, vị ngọt sắc và hương thơm nức đặc trưng của thủ phủ xoài Tiền Giang.',
      images: [
        'https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm1.id,
      moqGrams: 30000, // 30kg
      leadTimeDays: 1,
      seasonStatus: SeasonStatus.HARVESTING,
      requiresCold: false,
      packagings: {
        create: [
          { name: 'Thùng carton lót mút 10kg', weightGrams: 10000, isSample: false },
          { name: 'Thùng carton 15kg', weightGrams: 15000, isSample: false },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 30000, pricePerKg: 65000 },
          { minGrams: 100000, pricePerKg: 60000 },
        ],
      },
    },
  })

  // SP 5: Bơ Sáp 034 Tây Nguyên (Farm 3)
  const pBo = await prisma.product.upsert({
    where: { slug: 'bo-034-tay-nguyen' },
    update: {},
    create: {
      slug: 'bo-034-tay-nguyen',
      name: 'Bơ Sáp 034 Đắk Lắk (Quả Dài Cơm Vàng Dẻo)',
      description:
        'Bơ 034 quả dài từ 25 - 35cm, vỏ xanh bóng, cơm vàng hạt lép, độ dẻo và béo ngậy tự nhiên đứng đầu các dòng bơ nhiệt đới.',
      images: [
        'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm3.id,
      moqGrams: 30000,
      leadTimeDays: 2,
      seasonStatus: SeasonStatus.HARVESTING,
      requiresCold: false,
      packagings: {
        create: [
          { name: 'Thùng carton 10kg đục lỗ thoáng', weightGrams: 10000, isSample: false },
          { name: 'Rổ nhựa 20kg chuyên sỉ', weightGrams: 20000, isSample: false },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 30000, pricePerKg: 50000 },
          { minGrams: 100000, pricePerKg: 45000 },
        ],
      },
    },
  })

  // SP 6: Thanh Long Ruột Đỏ Chợ Gạo (Farm 1)
  await prisma.product.upsert({
    where: { slug: 'thanh-long-ruot-do' },
    update: {},
    create: {
      slug: 'thanh-long-ruot-do',
      name: 'Thanh Long Ruột Đỏ Chợ Gạo (Tai Xanh Quả To)',
      description:
        'Vỏ đỏ tươi, tai xanh dày chắc, ruột đỏ thẩm ngọt lịm hàm lượng dinh dưỡng cao. Thu hoạch cắt tai chuẩn kỹ thuật cho siêu thị.',
      images: [
        'https://images.unsplash.com/photo-1527325678964-54921661f888?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm1.id,
      moqGrams: 50000,
      leadTimeDays: 1,
      seasonStatus: SeasonStatus.HARVESTING,
      requiresCold: false,
      packagings: {
        create: [
          { name: 'Thùng xốp 10kg', weightGrams: 10000, isSample: false },
          { name: 'Rổ nhựa 20kg', weightGrams: 20000, isSample: false },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 50000, pricePerKg: 30000 },
          { minGrams: 200000, pricePerKg: 25000 },
        ],
      },
    },
  })

  // SP 7: Chôm Chôm Nhãn Tiền Giang (Farm 1)
  await prisma.product.upsert({
    where: { slug: 'chom-chom-nhan' },
    update: {},
    create: {
      slug: 'chom-chom-nhan',
      name: 'Chôm Chôm Nhãn Đường Phù Sa (Tróc Vỏ Cùi Dày)',
      description:
        'Chôm chôm nhãn trái nhỏ tròn, râu ngắn, cơm dày róc hạt, vị ngọt đậm đà mùi thơm như đường thốt nốt. Đóng sọt tươi rói trong ngày.',
      images: [
        'https://images.unsplash.com/photo-1587132137056-bfbf0166836e?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm1.id,
      moqGrams: 30000,
      leadTimeDays: 1,
      seasonStatus: SeasonStatus.HARVESTING,
      requiresCold: false,
      packagings: {
        create: [
          { name: 'Sọt tre lót lá 15kg', weightGrams: 15000, isSample: false },
          { name: 'Thùng carton 10kg', weightGrams: 10000, isSample: false },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 30000, pricePerKg: 35000 },
          { minGrams: 100000, pricePerKg: 30000 },
        ],
      },
    },
  })

  // SP 8: Măng Cụt Bến Tre - Sản phẩm UPCOMING có Pre-order
  const nextMonthFrom = new Date()
  nextMonthFrom.setDate(nextMonthFrom.getDate() + 30)
  const nextMonthTo = new Date()
  nextMonthTo.setDate(nextMonthTo.getDate() + 45)

  await prisma.product.upsert({
    where: { slug: 'mang-cut-ben-tre' },
    update: {},
    create: {
      slug: 'mang-cut-ben-tre',
      name: 'Măng Cụt Cổ Thụ Mỏ Cày (Mở Đặt Trước Vụ Mùa)',
      description:
        'Đặc sản măng cụt cây cổ thụ trên 30 năm tuổi, vỏ mỏng da cám, cơm trắng ngần không múi điếc, vị ngọt chua thanh tao danh bất hư truyền. Mở đặt trước vụ mùa thu hoạch tháng tới với ưu đãi giữ giá.',
      images: [
        'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=800&q=80',
      ],
      farmId: farm2.id,
      moqGrams: 50000,
      leadTimeDays: 3,
      seasonStatus: SeasonStatus.UPCOMING,
      requiresCold: true,
      preorderOpen: true,
      preorderPricePerKg: 90000,
      preorderBandPercent: 10,
      expectedHarvestFrom: nextMonthFrom,
      expectedHarvestTo: nextMonthTo,
      packagings: {
        create: [
          { name: 'Thùng carton 10kg thông hơi', weightGrams: 10000, isSample: false },
          { name: 'Rổ nhựa 20kg', weightGrams: 20000, isSample: false },
        ],
      },
      priceTiers: {
        create: [
          { minGrams: 50000, pricePerKg: 95000 },
          { minGrams: 200000, pricePerKg: 90000 },
        ],
      },
    },
  })

  // 5. Năng lực cung ứng theo tuần (Weekly Capacity)
  console.log('-> Tạo sản lượng khả dụng theo tuần (Weekly Capacity)...')
  const thisMonday = getMonday(new Date())
  const nextMonday = new Date(thisMonday)
  nextMonday.setDate(nextMonday.getDate() + 7)

  // Ri6: 5.000kg tuần này, 6.000kg tuần sau
  await prisma.weeklyCapacity.upsert({
    where: { productId_weekStart: { productId: pRi6.id, weekStart: thisMonday } },
    update: {},
    create: { productId: pRi6.id, weekStart: thisMonday, maxGrams: 5000000 },
  })
  await prisma.weeklyCapacity.upsert({
    where: { productId_weekStart: { productId: pRi6.id, weekStart: nextMonday } },
    update: {},
    create: { productId: pRi6.id, weekStart: nextMonday, maxGrams: 6000000 },
  })

  // Bưởi Da Xanh: 4.000kg tuần này
  await prisma.weeklyCapacity.upsert({
    where: { productId_weekStart: { productId: pBuoi.id, weekStart: thisMonday } },
    update: {},
    create: { productId: pBuoi.id, weekStart: thisMonday, maxGrams: 4000000 },
  })

  // 6. Lô hàng (Batches) và mã QR
  console.log('-> Tạo lô hàng thu hoạch và mã định danh QR...')
  await prisma.batch.upsert({
    where: { code: 'LO-261013-001' },
    update: {},
    create: {
      code: 'LO-261013-001',
      productId: pRi6.id,
      farmId: farm1.id,
      harvestDate: new Date(),
      quantityGrams: 5000000, // 5 tấn
      note: 'Lô sầu riêng cắt đợt 1 khu vườn A, độ chín già 8.5 tuổi, tỷ lệ cơm vàng 100%.',
    },
  })

  await prisma.batch.upsert({
    where: { code: 'LO-261013-002' },
    update: {},
    create: {
      code: 'LO-261013-002',
      productId: pBuoi.id,
      farmId: farm2.id,
      harvestDate: new Date(),
      quantityGrams: 3000000, // 3 tấn
      note: 'Lô bưởi thu hoạch rộ vụ hè, vỏ mỏng căng bóng, độ brix đạt 12.5.',
    },
  })

  await prisma.batch.upsert({
    where: { code: 'LO-261013-003' },
    update: {},
    create: {
      code: 'LO-261013-003',
      productId: pBo.id,
      farmId: farm3.id,
      harvestDate: new Date(),
      quantityGrams: 2000000, // 2 tấn
      note: 'Lô bơ sáp 034 tuyển chọn loại 1 cây 7 năm tuổi, chiều dài trái 28-32cm.',
    },
  })

  console.log('✅ Seed dữ liệu thành công hoàn tất!')
  console.log('---')
  console.log(`- Tài khoản Admin: ${adminEmail} (Mật khẩu: ${adminPassword})`)
  console.log('- Demo TIER1_AGENT: daily1@nongsanb2b.vn (Mật khẩu: Demo@123)')
  console.log('- Demo SUPERMARKET: sieuthi@nongsanb2b.vn (Mật khẩu: Demo@123)')
  console.log('- Demo SMALL_SHOP:  taphoa@nongsanb2b.vn  (Mật khẩu: Demo@123)')
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi seed dữ liệu:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
