import type { ToolHandler } from '../../types/mcp.js';
import {
  assertApiSuccess,
  handleError,
  createSuccessResult,
  MCPError,
  ErrorCode,
} from '../../utils/errorHandler.js';
import { desensitizeOrderDetail, stripOrderDetailDiscountFields } from '../../utils/desensitize.js';
import { z } from 'zod';

// 参数验证Schema
const getOrderDetailsV2Schema = z.object({
  orderId: z.union([z.string(), z.number()]).transform((val) => String(val)),
});

// API响应类型
interface OrderGetView {
  orderId: number;
  saleCampId: number;
  channelId: number;
  orderChannelId: number;
  order2ChannelId: number;
  outOrderId: string;
  outDecryptOrderId: string;
  outOrder2Id: string;
  outDecryptOrder2Id: string;
  outPaymentOrderId: string;
  creatorName: string;
  guestName: string;
  guestMobile: string;
  virtualMobile: {
    virtualMobileDetails: Array<{
      mobile: string;
      extensionNumber: string;
      firstVerificationCode: string;
      secondVerificationCode: string;
    }>;
  };
  channelGuestName: string;
  channelGuestMobile: string;
  urgencyGuestName: string;
  urgencyGuestMobile: string;
  userHeadImage: string;
  bookedTime: string;
  updatedTime: string;
  createTime: string;
  payExpiredTime: string;
  orderState: number;
  settleState: number;
  isSupportSettle: number;
  isOta: number;
  isLt: number;
  ltRentStartDate: string;
  ltRentEndDate: string;
  ltRentPrice: number;
  ltDepositPrice: number;
  ltDepositMonth: number;
  ltPaymentCycle: number;
  ltIsOpenReminder: number;
  ltReminderDaysBeforeCollect: number;
  currency: string;
  orderExpectedPrice: number;
  orderTotalIncomePrice: number;
  invoicePrice: number;
  includeCommissionRoomPrice: number;
  platformServicePrice: number;
  totalRoomPrice: number;
  otherPrice: number;
  totalPrice: number;
  totalPayPrice: number;
  totalReducePrice: number;
  isOldDebt: number;
  debtPrice: number;
  debtPriceDetails: Array<{
    roomCategoryName: string;
    roomName: string;
    paymentTypeId: number;
    paymentTypeName: string;
    price: number;
  }>;
  refundOrderId: number;
  refundDisplayState: number;
  remark: string;
  isHasException: number;
  isShowGetVirtualNumberBtn: number;
  attachment: {
    medias: Array<{
      mediaId: number;
    }>;
  };
  promotionUserId: number;
  promotionUserName: string;
  amortizeType: number;
  invoiceIssuer: string;
  newInvoicePrice: number;
  updateInvoicePrice: number;
  isEditionReplaceOrder: number;
  orderDetails: Array<{
    checkInDateStr: string;
    checkOutDateStr: string;
    expectCheckInTimeStr: string;
    expectCheckOutTimeStr: string;
    orderDetailId: number;
    orderId: number;
    roomCategoryId: number;
    roomCategoryName: string;
    roomCategoryType: number;
    roomCategoryTypeName: string;
    categoryName: string;
    roomId: number;
    outRoomId: string;
    roomName: string;
    isDirty: number;
    deviceId: number;
    cardDeviceId: number;
    zzjDepositPrice: number;
    breakfastNum: number;
    isArrangeRoom: number;
    isOccupation: number;
    isStatistics: number;
    isCanLink: number;
    saleType: number;
    isInOrderBox: number;
    isHasOrderBoxTag: number;
    orderState: number;
    orderDetailState: number;
    mainPhotoMediaId: number;
    guestNum: number;
    isMappingPoliceAccount: number;
    isMappingLockDevice: number;
    isSupportProduct: number;
    isSupportCheckinGuide: number;
    checkinGuideId: number;
    isSupportSendCheckinPoster: number;
    checkinGuestNum: number;
    roomPrice: number;
    invoicePrice: number;
    includeCommissionRoomPrice: number;
    platformServicePrice: number;
    otherPrice: number;
    hostIncomePrice: number;
    paymentPrice: number;
    totalPrice: number;
    num: number;
    price: number;
    reducePrice: number;
    unitPrice: number;
  }>;
  [key: string]: unknown; // 允许其他字段
}

interface APIResponse<T> {
  success: boolean;
  errorCode?: string;
  errorMsg?: string;
  errorDetail?: string;
  data?: T;
}

export const getOrderDetailsV2Handler: ToolHandler = async (args, context) => {
  try {
    const { apiClient, logger, permissionChecker } = context;

    // 权限检查
    permissionChecker.checkPermission('get_order_details_v2', ['orders:read']);

    // 参数验证
    const validatedParams = getOrderDetailsV2Schema.parse(args);
    
    logger.info('Getting order details (v2)', { orderId: validatedParams.orderId });

    // 从context中获取campId
    const campId = context.campId;
    if (!campId) {
      throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
    }

    // 调用API
    const response = await apiClient.request<APIResponse<OrderGetView>>({
      method: 'POST',
      url: '/order/get',
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        campId: String(campId),
        orderId: validatedParams.orderId,
      },
    });

    assertApiSuccess(response, '订单详情查询', 'orders');

    logger.info('Order details retrieved successfully (v2)', {
      orderId: validatedParams.orderId,
    });

    const data = response.data as OrderGetView | undefined;
    if (data == null || data.orderId == null) {
      throw new MCPError(ErrorCode.API_NOT_FOUND, '未查询到相关订单数据', {
        domain: 'order_detail',
        source: '路客云AI',
      });
    }
    const safeData = stripOrderDetailDiscountFields(
      desensitizeOrderDetail(data as unknown as Record<string, unknown>)
    );
    return createSuccessResult(safeData);
  } catch (error) {
    return handleError(error);
  }
};
